import { MigrationInterface, QueryRunner } from "typeorm";

export class DomainsAndPhone1795238453413 implements MigrationInterface {
    name = 'DomainsAndPhone1795238453413'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "phone_numbers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "number" character varying(20) NOT NULL, "label" character varying(80) NOT NULL DEFAULT '', "forward_to" character varying(20), "ring_seconds" integer NOT NULL DEFAULT '20', "voicemail_enabled" boolean NOT NULL DEFAULT true, "greeting" character varying(500) NOT NULL DEFAULT 'Sorry, we cannot take your call right now. Please leave a message after the tone.', "text_back_enabled" boolean NOT NULL DEFAULT true, "text_back_message" character varying(480) NOT NULL DEFAULT 'Hi {{first_name}}, sorry we missed your call! This is {{business}} — how can we help?', "text_back_cooldown_hours" integer NOT NULL DEFAULT '24', CONSTRAINT "PK_a72cf9a1834a1417e195fdd2c02" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7ed0c0f76fe9cf21c60d83ea3f" ON "phone_numbers" ("workspace_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_cec2ce00cf156450c79a9dc6b0" ON "phone_numbers" ("number") WHERE "deleted_at" IS NULL`);
        await queryRunner.query(`CREATE TABLE "calls" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "phone_number_id" uuid NOT NULL, "contact_id" uuid, "call_sid" character varying(64) NOT NULL, "from_number" character varying(32) NOT NULL, "to_number" character varying(32) NOT NULL, "status" character varying(12) NOT NULL DEFAULT 'ringing', "duration_sec" integer NOT NULL DEFAULT '0', "recording_url" character varying(500), "recording_duration_sec" integer, "texted_back_at" TIMESTAMP WITH TIME ZONE, "ended_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_d9171d91f8dd1a649659f1b6a20" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_16a8f4e9a94a5823aa7f2233bc" ON "calls" ("workspace_id", "from_number", "texted_back_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_817c0013fa6f84ab5f4d3c3295" ON "calls" ("workspace_id", "created_at") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_c088e5c214c6207c43996ac638" ON "calls" ("call_sid") `);
        await queryRunner.query(`CREATE TABLE "custom_domains" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "site_id" uuid NOT NULL, "hostname" character varying(253) NOT NULL, "status" character varying(10) NOT NULL DEFAULT 'pending', "verification_token" character varying(40) NOT NULL, "verified_at" TIMESTAMP WITH TIME ZONE, "last_checked_at" TIMESTAMP WITH TIME ZONE, "last_error" character varying(300), CONSTRAINT "PK_53c30715082abb90e5063a2a397" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_be7dab3d03216d1ab32f073533" ON "custom_domains" ("status", "last_checked_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_ae7c32a5276e747a44d95863a8" ON "custom_domains" ("site_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_2ea2b89ccbe7cc5f565955556e" ON "custom_domains" ("hostname") WHERE "status" = 'verified' AND "deleted_at" IS NULL`);
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
        await queryRunner.query(`DROP INDEX "public"."IDX_2ea2b89ccbe7cc5f565955556e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ae7c32a5276e747a44d95863a8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_be7dab3d03216d1ab32f073533"`);
        await queryRunner.query(`DROP TABLE "custom_domains"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c088e5c214c6207c43996ac638"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_817c0013fa6f84ab5f4d3c3295"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_16a8f4e9a94a5823aa7f2233bc"`);
        await queryRunner.query(`DROP TABLE "calls"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cec2ce00cf156450c79a9dc6b0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7ed0c0f76fe9cf21c60d83ea3f"`);
        await queryRunner.query(`DROP TABLE "phone_numbers"`);
    }

}
