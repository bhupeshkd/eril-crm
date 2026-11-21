import { MigrationInterface, QueryRunner } from "typeorm";

export class SaasMode1795198725020 implements MigrationInterface {
    name = 'SaasMode1795198725020'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "saas_settings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "organization_id" uuid NOT NULL, "billing_workspace_id" uuid, "currency" character varying(3) NOT NULL DEFAULT 'USD', "email_price" numeric(10,4) NOT NULL DEFAULT '0', "sms_price" numeric(10,4) NOT NULL DEFAULT '0', "grace_days" integer NOT NULL DEFAULT '7', CONSTRAINT "PK_5bf89ab9e3a9600e69b97acd067" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_1ca4a5cfda05fc0cbd3e252d36" ON "saas_settings" ("organization_id") `);
        await queryRunner.query(`CREATE TABLE "saas_plans" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "organization_id" uuid NOT NULL, "name" character varying(120) NOT NULL, "description" text NOT NULL DEFAULT '', "price" numeric(12,2) NOT NULL, "interval" character varying(5) NOT NULL DEFAULT 'month', "trial_days" integer NOT NULL DEFAULT '0', "features" text array NOT NULL DEFAULT '{}', "limits" jsonb NOT NULL DEFAULT '{"contacts":null,"users":null}', "included" jsonb NOT NULL DEFAULT '{"emails":0,"sms":0}', "product_id" uuid, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_7828a0c1b0c60456fdd27e9c31c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_1c86856249aaef7817ecf311d5" ON "saas_plans" ("organization_id") `);
        await queryRunner.query(`CREATE TABLE "saas_accounts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "organization_id" uuid NOT NULL, "workspace_id" uuid NOT NULL, "plan_id" uuid NOT NULL, "subscription_id" uuid, "billing_contact_id" uuid NOT NULL, CONSTRAINT "PK_f27f16a7f9aa98ebbbd9012f523" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_cbf94b5af50b420f5689ca074c" ON "saas_accounts" ("organization_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_32247fd5582a592e04805fb079" ON "saas_accounts" ("workspace_id") `);
        await queryRunner.query(`CREATE TABLE "saas_usage_bills" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "organization_id" uuid NOT NULL, "workspace_id" uuid NOT NULL, "period" character varying(7) NOT NULL, "emails" integer NOT NULL DEFAULT '0', "sms" integer NOT NULL DEFAULT '0', "amount" numeric(12,2) NOT NULL DEFAULT '0', "invoice_id" uuid, CONSTRAINT "PK_657cd62e2f3b17e1efef4d2f88c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_47da7157c6bc2d1b8eb17f468e" ON "saas_usage_bills" ("workspace_id", "period") `);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"recipients":0,"sent":0,"failed":0,"skipped":0}'`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0":[],"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}],"6":[]}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0": [], "1": [{"end": "17:00", "start": "09:00"}], "2": [{"end": "17:00", "start": "09:00"}], "3": [{"end": "17:00", "start": "09:00"}], "4": [{"end": "17:00", "start": "09:00"}], "5": [{"end": "17:00", "start": "09:00"}], "6": []}'`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"sent": 0, "failed": 0, "skipped": 0, "recipients": 0}'`);
        await queryRunner.query(`DROP INDEX "public"."IDX_47da7157c6bc2d1b8eb17f468e"`);
        await queryRunner.query(`DROP TABLE "saas_usage_bills"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_32247fd5582a592e04805fb079"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cbf94b5af50b420f5689ca074c"`);
        await queryRunner.query(`DROP TABLE "saas_accounts"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1c86856249aaef7817ecf311d5"`);
        await queryRunner.query(`DROP TABLE "saas_plans"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1ca4a5cfda05fc0cbd3e252d36"`);
        await queryRunner.query(`DROP TABLE "saas_settings"`);
    }

}
