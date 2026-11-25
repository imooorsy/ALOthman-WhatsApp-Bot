import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  Post,
  Req,
  Res,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { Throttle } from "@nestjs/throttler";
import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";
import { compare } from "bcrypt";
import type { Request, Response } from "express";
import { Db } from "./db";
export type Actor = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "employee";
};
export type AuthRequest = Request & { user: Actor };
export const Admin = () => SetMetadata("admin", true);
export const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  notifyPrefs: true,
} as const;
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwt: JwtService,
    private db: Db,
    private reflector: Reflector,
  ) {}
  async actor(token: string | undefined) {
    try {
      const payload = this.jwt.verify<{ sub: string }>(token || "");
      const user = await this.db.staffUser.findUnique({
        where: { id: payload.sub },
        select: userSelect,
      });
      if (!user) throw new Error();
      return user;
    } catch {
      throw new UnauthorizedException("يرجى تسجيل الدخول");
    }
  }
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    req.user = await this.actor(req.cookies?.osman_session);
    if (
      this.reflector.getAllAndOverride("admin", [
        context.getHandler(),
        context.getClass(),
      ]) &&
      req.user.role !== "admin"
    )
      throw new ForbiddenException("هذه العملية للمدير فقط");
    return true;
  }
}
class LoginDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MinLength(1) @MaxLength(128) password!: string;
}
export const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
});
@Controller("auth")
export class AuthController {
  constructor(
    private db: Db,
    private jwt: JwtService,
  ) {}
  @Post("login")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.db.staffUser.findUnique({
      where: { email: body.email.toLowerCase() },
    });
    // Constant work for unknown emails, using a valid bcrypt hash.
    const valid = await compare(
      body.password,
      user?.passwordHash ||
        "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxkHSH6A2kz8Z8qxA6QGQ0aC5Hy",
    );
    if (!user || !valid)
      throw new UnauthorizedException(
        "البريد الإلكتروني أو كلمة المرور غير صحيحة",
      );
    res.cookie("osman_session", await this.jwt.signAsync({ sub: user.id }), {
      ...cookieOptions(),
      maxAge: 8 * 60 * 60 * 1000,
    });
    const { passwordHash: _, ...safe } = user;
    return safe;
  }
  @Get("me") @UseGuards(AuthGuard) me(@Req() req: AuthRequest) {
    return req.user;
  }
  @Post("logout") @UseGuards(AuthGuard) logout(
    @Res({ passthrough: true }) res: Response,
  ) {
    res.clearCookie("osman_session", cookieOptions());
    return { ok: true };
  }
}
