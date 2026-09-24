import OpenAI from "npm:openai";
import { createClient } from "npm:@supabase/supabase-js@2";

const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY")! });

Deno.serve(async req => {
  if(req.method!=="POST") return new Response(JSON.stringify({error:"POST required"}),{status:405,headers:{"content-type":"application/json"}});
  try{
    const auth=req.headers.get("Authorization")||"";
    if(!auth.startsWith("Bearer ")) throw new Error("Authentication required");
    const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:auth}}});
    const {data:{user},error:ue}=await supabase.auth.getUser();
    if(ue||!user) throw new Error("Authentication required");

    const {image_data_url}=await req.json();
    if(typeof image_data_url!=="string"||!image_data_url.startsWith("data:image/")) throw new Error("A machine plate image is required");
    if(image_data_url.length>8_000_000) throw new Error("Plate image is too large. Use a clear, close photo under 6 MB.");

    const response=await openai.responses.create({
      model:"gpt-5.5",
      input:[{
        role:"user",
        content:[
          {type:"input_text",text:"Identify the machinery model/serial plate in this image for REELMOW. Read only visible text. Never guess missing characters. Return likely manufacturer, product family, model, variant, serial number and confidence. Confidence must reflect only what is visibly supported. If uncertain, use null and explain the uncertainty."},
          {type:"input_image",image_url:image_data_url}
        ]
      }],
      text:{format:{type:"json_schema",name:"reelmow_machine_identification",strict:true,schema:{
        type:"object",additionalProperties:false,
        properties:{
          manufacturer:{anyOf:[{type:"string"},{type:"null"}]},
          product_family:{anyOf:[{type:"string"},{type:"null"}]},
          model:{anyOf:[{type:"string"},{type:"null"}]},
          variant:{anyOf:[{type:"string"},{type:"null"}]},
          serial_number:{anyOf:[{type:"string"},{type:"null"}]},
          visible_text:{type:"string"},
          confidence:{type:"number",minimum:0,maximum:1},
          uncertainty:{type:"string"}
        },
        required:["manufacturer","product_family","model","variant","serial_number","visible_text","confidence","uncertainty"]
      }}}
    });
    return new Response(response.output_text,{headers:{"content-type":"application/json"}});
  }catch(error){
    return new Response(JSON.stringify({error:error?.message||"Identification failed"}),{status:400,headers:{"content-type":"application/json"}});
  }
});