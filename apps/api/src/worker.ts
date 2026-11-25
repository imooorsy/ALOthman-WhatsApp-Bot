import {Injectable,OnApplicationBootstrap} from '@nestjs/common';
import {QueueService} from './queue';
import {InboundService} from './inbound';
@Injectable()
export class ConversationWorker implements OnApplicationBootstrap {
 constructor(private queue:QueueService,private inbound:InboundService){}
 async onApplicationBootstrap(){await this.queue.boss.work<{conversationId:string}>('conversation',{batchSize:1,pollingIntervalSeconds:0.5},async jobs=>{for(const job of jobs)await this.inbound.process(job.data.conversationId);});}
}
