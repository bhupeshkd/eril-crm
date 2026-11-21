import { MigrationInterface, QueryRunner } from "typeorm";

export class EmailTemplates1794896165192 implements MigrationInterface {
    name = 'EmailTemplates1794896165192'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "email_templates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "name" character varying(255) NOT NULL, "subject" character varying(255) NOT NULL DEFAULT '', "preview_text" character varying(255) NOT NULL DEFAULT '', "theme" jsonb NOT NULL DEFAULT '{}', "blocks" jsonb NOT NULL DEFAULT '[]', CONSTRAINT "PK_06c564c515d8cdb40b6f3bfbbb4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_26b1f4790a696577145a7af0b8" ON "email_templates" ("workspace_id") `);
        await queryRunner.query(`ALTER TABLE "messages" ADD "html" text`);
        await queryRunner.query(`ALTER TABLE "campaigns" ADD "template_id" uuid`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"recipients":0,"sent":0,"failed":0,"skipped":0}'`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0":[],"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}],"6":[]}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0": [], "1": [{"end": "17:00", "start": "09:00"}], "2": [{"end": "17:00", "start": "09:00"}], "3": [{"end": "17:00", "start": "09:00"}], "4": [{"end": "17:00", "start": "09:00"}], "5": [{"end": "17:00", "start": "09:00"}], "6": []}'`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"sent": 0, "failed": 0, "skipped": 0, "recipients": 0}'`);
        await queryRunner.query(`ALTER TABLE "campaigns" DROP COLUMN "template_id"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "html"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_26b1f4790a696577145a7af0b8"`);
        await queryRunner.query(`DROP TABLE "email_templates"`);
    }

}
