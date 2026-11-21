import { MigrationInterface, QueryRunner } from "typeorm";

export class ChatWidget1795200280510 implements MigrationInterface {
    name = 'ChatWidget1795200280510'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "chat_widgets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "public_key" character varying(32) NOT NULL, "enabled" boolean NOT NULL DEFAULT false, "title" character varying(60) NOT NULL DEFAULT 'Chat with us', "greeting" character varying(300) NOT NULL DEFAULT 'Hi! How can we help you today?', "ask_for" character varying(20) NOT NULL DEFAULT 'email', "color" character varying(7) NOT NULL DEFAULT '', "position" character varying(5) NOT NULL DEFAULT 'right', CONSTRAINT "PK_2a6f4b2859adb0b0f60e7d4e7db" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_4c1fac0284b29f71130a053a45" ON "chat_widgets" ("public_key") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_5c2b05c79d1a59ba347eb0be40" ON "chat_widgets" ("workspace_id") `);
        await queryRunner.query(`CREATE TABLE "chat_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "contact_id" uuid NOT NULL, "conversation_id" uuid NOT NULL, "token_hash" character varying(64) NOT NULL, "page_url" character varying(500) NOT NULL DEFAULT '', "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_efc151a4aafa9a28b73dedc485f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_6fc15757fca78798716db00ade" ON "chat_sessions" ("workspace_id", "contact_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_5ec28f8ac6d1d80fc239bc3bc8" ON "chat_sessions" ("token_hash") `);
        await queryRunner.query(`ALTER TABLE "saas_plans" ALTER COLUMN "limits" SET DEFAULT '{"contacts":null,"users":null}'`);
        await queryRunner.query(`ALTER TABLE "saas_plans" ALTER COLUMN "included" SET DEFAULT '{"emails":0,"sms":0}'`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"recipients":0,"sent":0,"failed":0,"skipped":0}'`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0":[],"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}],"6":[]}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0": [], "1": [{"end": "17:00", "start": "09:00"}], "2": [{"end": "17:00", "start": "09:00"}], "3": [{"end": "17:00", "start": "09:00"}], "4": [{"end": "17:00", "start": "09:00"}], "5": [{"end": "17:00", "start": "09:00"}], "6": []}'`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"sent": 0, "failed": 0, "skipped": 0, "recipients": 0}'`);
        await queryRunner.query(`ALTER TABLE "saas_plans" ALTER COLUMN "included" SET DEFAULT '{"sms": 0, "emails": 0}'`);
        await queryRunner.query(`ALTER TABLE "saas_plans" ALTER COLUMN "limits" SET DEFAULT '{"users": null, "contacts": null}'`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5ec28f8ac6d1d80fc239bc3bc8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6fc15757fca78798716db00ade"`);
        await queryRunner.query(`DROP TABLE "chat_sessions"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5c2b05c79d1a59ba347eb0be40"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4c1fac0284b29f71130a053a45"`);
        await queryRunner.query(`DROP TABLE "chat_widgets"`);
    }

}
