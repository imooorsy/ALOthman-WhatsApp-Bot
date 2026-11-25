import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  private log = new Logger("Request");
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    if (status >= 500) this.log.error("Request failed; no request data logged");
    response
      .status(status)
      .json({
        statusCode: status,
        message:
          status === 429
            ? "طلبات كثيرة؛ انتظر قليلًا وحاول مجددًا"
            : status === 404
              ? "المورد المطلوب غير موجود"
              : error instanceof HttpException
                ? error.getResponse() instanceof Object
                  ? (error.getResponse() as { message?: unknown }).message ||
                    "تعذر تنفيذ الطلب"
                  : error.message
                : "تعذر تنفيذ الطلب؛ حاول مجددًا",
      });
  }
}
