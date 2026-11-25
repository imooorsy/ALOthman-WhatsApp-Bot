import {BadRequestException,Body,ConflictException,Controller,Get,Injectable,Put,Req,UseGuards} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import {notifyPrefsSchema,OfficeConfig,settingsSchema} from '@osman/shared';
import {Db} from './db';
import {Admin,AuthGuard,AuthRequest} from './auth';
import {RealtimeGateway} from './realtime';
@Injectable()
export class SettingsService {
 constructor(private db:Db){}
 async get():Promise<OfficeConfig>{
  const [row,services,categories]=await this.db.$transaction([this.db.officeSettings.findUniqueOrThrow({where:{id:1}}),this.db.service.findMany({orderBy:{sort:'asc'}}),this.db.caseCategory.findMany({orderBy:{sort:'asc'}})]);
  return {...settingsSchema.parse({...row.data as object,services:services.map(s=>({...s,price:Number(s.price)})),categories}),version:row.configVersion};
 }
 async save(body:unknown){
  const parsed=settingsSchema.extend({version:requireVersion}).safeParse(body);
  if(!parsed.success)throw new BadRequestException('تحقق من الحقول المطلوبة والأرقام والأسعار');
  const {services,categories,version,...data}=parsed.data;
  await this.db.$transaction(async tx=>{
   const updated=await tx.officeSettings.updateMany({where:{id:1,configVersion:version},data:{data:data as Prisma.InputJsonValue,configVersion:{increment:1}}});
   if(!updated.count)throw new ConflictException('تغيرت الإعدادات لدى مستخدم آخر؛ أعد تحميل الصفحة');
   await tx.service.deleteMany();await tx.caseCategory.deleteMany();
   await tx.service.createMany({data:services});await tx.caseCategory.createMany({data:categories});
  });
  return this.get();
 }
}
import {z} from 'zod';
const requireVersion=z.number().int().positive();
@Controller('settings') @UseGuards(AuthGuard)
export class SettingsController {
 constructor(private settings:SettingsService,private db:Db,private realtime:RealtimeGateway){}
 @Get() get(){return this.settings.get();}
 @Put() @Admin() async save(@Body() body:unknown){const result=await this.settings.save(body);this.realtime.settings(result.rules.paused);return result;}
 @Put('preferences') async prefs(@Body() body:unknown,@Req() req:AuthRequest){const parsed=notifyPrefsSchema.safeParse(body);if(!parsed.success)throw new BadRequestException('إعدادات إشعارات غير صالحة');return this.db.staffUser.update({where:{id:req.user.id},data:{notifyPrefs:parsed.data},select:{notifyPrefs:true}});}
}
