import { MigrationInterface, QueryRunner } from "typeorm";

export class MetaMessaging1795247089582 implements MigrationInterface {
    name = 'MetaMessaging1795247089582'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "meta_pages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "platform" character varying(10) NOT NULL, "page_id" character varying(32) NOT NULL, "name" character varying(120) NOT NULL, "access_token" text NOT NULL, CONSTRAINT "PK_e9033bf7795cd98931fdf1890f0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d2b3f544ba928778b12ca5cd80" ON "meta_pages" ("workspace_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_b35f35e1121336b8f38df66d08" ON "meta_pages" ("platform", "page_id") WHERE "deleted_at" IS NULL`);
        await queryRunner.query(`CREATE TABLE "meta_identities" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "platform" character varying(10) NOT NULL, "page_id" character varying(32) NOT NULL, "psid" character varying(64) NOT NULL, "contact_id" uuid NOT NULL, "last_inbound_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_ef1cbb6f336b04e5ba08b8bb030" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_0f17f023d2384f6844fc337ddd" ON "meta_identities" ("workspace_id", "contact_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_3c3c18032791b6b59ef463d42c" ON "meta_identities" ("platform", "page_id", "psid") `);
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
        await queryRunner.query(`DROP INDEX "public"."IDX_3c3c18032791b6b59ef463d42c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0f17f023d2384f6844fc337ddd"`);
        await queryRunner.query(`DROP TABLE "meta_identities"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b35f35e1121336b8f38df66d08"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d2b3f544ba928778b12ca5cd80"`);
        await queryRunner.query(`DROP TABLE "meta_pages"`);
    }

}
