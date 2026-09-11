import type { ReplyKind } from "./reply.ts";

export type OutboxRow={
  id:string;
  session_id:string;
  turn_key:string;
  reply_kind:ReplyKind;
  body:string;
  status:string;
  chat_message_id?:string|null;
};

function clean(value:unknown):string{return String(value??"").replace(/\s+/g," ").trim();}

export async function enqueueReply(
  db:any,
  sessionId:string,
  turnKey:string,
  replyKind:ReplyKind,
  body:string,
):Promise<OutboxRow>{
  const payload={
    session_id:clean(sessionId),
    turn_key:clean(turnKey),
    reply_kind:replyKind,
    body:String(body??"").trim(),
  };
  if(!payload.session_id||!payload.turn_key||!payload.body)throw new Error("invalid_reply_outbox_payload");
  const {data,error}=await db.from("getlink_ai_reply_outbox")
    .upsert(payload,{onConflict:"session_id,turn_key,reply_kind"})
    .select("*")
    .single();
  if(error)throw error;
  if(!data?.id)throw new Error("reply_outbox_missing");
  return data as OutboxRow;
}

export async function flushReply(db:any,row:OutboxRow):Promise<string>{
  if(row?.status==="sent"&&clean(row?.chat_message_id))return clean(row.chat_message_id);
  const outboxId=clean(row?.id);
  const body=String(row?.body??"").trim();
  if(!outboxId||!body)throw new Error("invalid_reply_outbox_row");
  const {data,error}=await db.rpc("getlink_ai_send_chat_message",{
    p_outbox_id:outboxId,
    p_body:body,
    p_client_id:`ai:${outboxId}`,
  });
  if(error)throw error;
  const messageId=clean(data);
  if(!messageId)throw new Error("chat_message_missing");
  return messageId;
}

export async function enqueueAndFlushReply(
  db:any,
  sessionId:string,
  turnKey:string,
  replyKind:ReplyKind,
  body:string,
):Promise<string>{
  const row=await enqueueReply(db,sessionId,turnKey,replyKind,body);
  return flushReply(db,row);
}
