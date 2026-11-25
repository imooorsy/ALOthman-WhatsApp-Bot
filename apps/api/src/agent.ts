import {Injectable} from '@nestjs/common';
import {AgentPort,AgentRequest,AgentResponse,agentResponseSchema} from '@osman/shared';
export class MockAgent implements AgentPort {
 async respond(req:AgentRequest):Promise<AgentResponse>{
  const text=req.newMessages.join('\n');
  const action=/عاجل|urgent/i.test(text)?'handoff_urgent':/موظف|handoff/i.test(text)?'handoff':/خارج النطاق|غير مناسب|unsuitable/i.test(text)?'not_suitable':/موعد|انتهيت|completed/i.test(text)?'completed':'continue';
  return agentResponseSchema.parse({reply:action==='continue'?'معك عثمان. كيف يمكننا مساعدتك؟':action==='not_suitable'?'نعتذر، الطلب خارج نطاق خدمات المكتب.':action==='completed'?'تم استلام طلبك، بانتظار تحديد موعد مع السكرتيرة.':'تم تحويل طلبك إلى الفريق المختص.',action,category:req.config.categories.find(c=>c.active&&text.includes(c.name))?.name||null,clientName:null,summary:action==='continue'?null:'محادثة تجريبية تحتاج متابعة الفريق.',urgentReason:action==='handoff_urgent'?'طلب العميل متابعة عاجلة':null});
 }
}
@Injectable()
export class AgentService implements AgentPort {
 private adapter:AgentPort=new MockAgent();
 async respond(req:AgentRequest){return agentResponseSchema.parse(await this.adapter.respond(req));}
}
