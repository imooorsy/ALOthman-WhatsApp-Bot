import {Injectable} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
export interface IWhatsAppProvider {send(phone:string,text:string):Promise<{id:string}>}
@Injectable()
export class WhatsAppProvider implements IWhatsAppProvider {
 async send(_phone:string,_text:string){return {id:'mock-'+randomUUID()};}
}
