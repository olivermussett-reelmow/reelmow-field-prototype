import OpenAI from "npm:openai";
import { createClient } from "npm:@supabase/supabase-js@2";

const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY")! });
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const extractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    identity: {
      type: "object",
      additionalProperties: false,
      properties: {
        manufacturer: {type:"anyOf",items:[{type:"string"},{type:"null"}]},
        family: { type: ["string","null"] },
        model: { type: ["string","null"] },
        variant: { type: ["string","null"] },
        applicability_notes: { type: ["string","null"] }
      },
      required: ["manufacturer","family","model","variant","applicability_notes"]
    },
    specifications: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          field_key: { type: "string" },
          value: { type: "string" },
          unit: { type: ["string","null"] },
          confidence: { type: "number" },
          evidence: { type: "string" },
          page: { type: "integer" }
        },
        required: ["field_key","value","unit","confidence","evidence","page"]
      }
    },
    service_tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          task_key: { type: "string" },
          task_name: { type: "string" },
          instructions: { type: "string" },
          safety_notes: { type: ["string","null"] },
          interval_engine_hours: {type:"anyOf",items:[{type:"number"},{type:"null"}]},
          interval_reel_hours: { type: ["number","null"] },
          interval_calendar_days: { type: ["number","null"] },
          confidence: { type: "number" },
          evidence: { type: "string" },
          page: { type: "integer" }
        },
        required: ["task_key","task_name","instructions","safety_notes","interval_engine_hours","interval_reel_hours","interval_calendar_days","confidence","evidence","page"]
      }
    },
    parts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          part_number: { type: "string" },
          name: { type: "string" },
          fitment_notes: { type: ["string","null"] },
          confidence: { type: "number" },
          evidence: { type: "string" },
          page: { type: "integer" }
        },
        required: ["part_number","name","fitment_notes","confidence","evidence","page"]
      }
    },
    conflicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          field_key: { type: "string" },
          description: { type: "string" },
          page: { type: "integer" }
        },
        required: ["field_key","description","page"]
      }
    }
  },
  required: ["identity","specifications","service_tasks","parts","conflicts"]
};

function jsonHeaders(){ return {"content-type":"application/json"}; }

Deno.serve(async req => {
  if(req.method!=="POST") return new Response(JSON.stringify({error:"POST required"}),{status:405,headers:jsonHeaders()});
  try{
    const body=await req.json();
    const documentId=String(body.document_id||"");
    const pageText=String(body.page_text||"");
    const jobId=String(body.job_id||"");
    if(!documentId||!pageText||!jobId) return new Response(JSON.stringify({error:"document_id, job_id and page_text are required"}),{status:400,headers:jsonHeaders()});

    const {data:doc,error:de}=await supabase.schema("catalogue").from("documents").select("id,title,document_type,machine_model_id,machine_variant_id").eq("id",documentId).single();
    if(de) throw de;

    const {data:run,error:re}=await supabase.schema("ingestion").from("ai_runs").insert({
      job_id:jobId,document_id:documentId,provider:"openai",model:"gpt-5.5",task:"catalogue_document_extraction",status:"running"
    }).select("id").single();
    if(re) throw re;

    const response=await openai.responses.create({
      model:"gpt-5.5",
      input:[
        {role:"system",content:"You are the REELMOW machinery knowledge extraction engine. Extract only information explicitly supported by the supplied manufacturer document text. Never guess. Preserve variant applicability. Every fact must include page and a short evidence excerpt. If information is absent, omit it. If sources conflict, record a conflict instead of choosing silently."},
        {role:"user",content:"DOCUMENT: "+JSON.stringify(doc)+"\n\nPAGE TEXT:\n"+pageText}
      ],
      text:{format:{type:"json_schema",name:"reelmow_catalogue_extraction",strict:true,schema:extractionSchema}}
    });

    const parsed=JSON.parse(response.output_text);
    const usage=response.usage||{};
    await supabase.schema("ingestion").from("ai_runs").update({
      status:"completed",output_json:parsed,usage_json:usage,completed_at:new Date().toISOString()
    }).eq("id",run.id);

    const extracted=[];
    for(const x of parsed.specifications||[]) extracted.push({
      job_id:jobId,document_id:documentId,entity_type:"specification",field_key:x.field_key,
      raw_value:x.value,normalized_value:null,unit:x.unit,confidence_score:x.confidence,
      extraction_method:"openai_structured_output",status:"pending"
    });
    for(const x of parsed.service_tasks||[]) extracted.push({
      job_id:jobId,document_id:documentId,entity_type:"service_task",field_key:x.task_key,
      raw_value:x.task_name,normalized_value:{instructions:x.instructions,safety_notes:x.safety_notes,interval_engine_hours:x.interval_engine_hours,interval_reel_hours:x.interval_reel_hours,interval_calendar_days:x.interval_calendar_days,evidence:x.evidence,page:x.page},
      confidence_score:x.confidence,extraction_method:"openai_structured_output",status:"pending"
    });
    for(const x of parsed.parts||[]) extracted.push({
      job_id:jobId,document_id:documentId,entity_type:"part",field_key:x.part_number,
      raw_value:x.name,normalized_value:{fitment_notes:x.fitment_notes,evidence:x.evidence,page:x.page},
      confidence_score:x.confidence,extraction_method:"openai_structured_output",status:"pending"
    });
    if(extracted.length){
      const {error:xe}=await supabase.schema("ingestion").from("extracted_facts").insert(extracted);
      if(xe) throw xe;
    }

    return new Response(JSON.stringify({ok:true,ai_run_id:run.id,counts:{specifications:(parsed.specifications||[]).length,service_tasks:(parsed.service_tasks||[]).length,parts:(parsed.parts||[]).length,conflicts:(parsed.conflicts||[]).length}}),{headers:jsonHeaders()});
  }catch(error){
    return new Response(JSON.stringify({ok:false,error:error?.message||"Extraction failed"}),{status:500,headers:jsonHeaders()});
  }
});
