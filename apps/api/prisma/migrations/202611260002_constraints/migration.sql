ALTER TABLE "OfficeSettings" ADD CONSTRAINT "OfficeSettings_single_row" CHECK ("id" = 1);
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_nonnegative_version" CHECK ("version" >= 0);
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_nonnegative_unread" CHECK ("unreadCount" >= 0);
ALTER TABLE "Service" ADD CONSTRAINT "Service_nonnegative_price" CHECK ("price" >= 0);
ALTER TABLE "Client" ADD CONSTRAINT "Client_e164_phone" CHECK ("phone" ~ '^\+[1-9][0-9]{7,14}$');
