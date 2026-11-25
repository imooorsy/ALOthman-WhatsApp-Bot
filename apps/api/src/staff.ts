import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { hash } from "bcrypt";
import { Db } from "./db";
import { Admin, AuthGuard, AuthRequest, userSelect } from "./auth";
class StaffDto {
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(12) @MaxLength(128) password!: string;
  @IsIn(["admin", "employee"]) role!: "admin" | "employee";
}
class UpdateStaffDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsIn(["admin", "employee"]) role?: "admin" | "employee";
  @IsOptional() @IsString() @MinLength(12) @MaxLength(128) password?: string;
}
@Controller("staff")
@UseGuards(AuthGuard)
@Admin()
export class StaffController {
  constructor(private db: Db) {}
  @Get() list() {
    return this.db.staffUser.findMany({ select: userSelect });
  }
  @Post() async create(@Body() body: StaffDto) {
    try {
      return await this.db.staffUser.create({
        data: {
          name: body.name,
          email: body.email.toLowerCase(),
          passwordHash: await hash(body.password, 12),
          role: body.role,
        },
        select: userSelect,
      });
    } catch {
      throw new BadRequestException(
        "تعذر إنشاء الموظف؛ تحقق من البريد الإلكتروني",
      );
    }
  }
  @Patch(":id") async update(
    @Param("id") id: string,
    @Body() body: UpdateStaffDto,
    @Req() req: AuthRequest,
  ) {
    if (id === req.user.id && body.role === "employee")
      throw new BadRequestException("لا يمكنك إزالة صلاحية المدير من حسابك");
    const { password, ...data } = body;
    return this.db.staffUser.update({
      where: { id },
      data: {
        ...data,
        ...(password ? { passwordHash: await hash(password, 12) } : {}),
      },
      select: userSelect,
    });
  }
  @Delete(":id") async remove(
    @Param("id") id: string,
    @Req() req: AuthRequest,
  ) {
    if (id === req.user.id) throw new BadRequestException("لا يمكنك حذف حسابك");
    // Preserve historical authors and assignments; only unreferenced users can be removed.
    try {
      await this.db.staffUser.delete({ where: { id } });
      return { ok: true };
    } catch {
      throw new BadRequestException(
        "تعذر حذف موظف مرتبط بسجل محادثات؛ يمكنك تعديل صلاحياته",
      );
    }
  }
}
