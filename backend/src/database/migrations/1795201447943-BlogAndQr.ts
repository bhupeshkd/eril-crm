import { MigrationInterface, QueryRunner } from "typeorm";

export class BlogAndQr1795201447943 implements MigrationInterface {
    name = 'BlogAndQr1795201447943'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "blog_posts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "site_id" uuid NOT NULL, "title" character varying(200) NOT NULL, "slug" character varying(100) NOT NULL, "excerpt" character varying(300) NOT NULL DEFAULT '', "body" text NOT NULL DEFAULT '', "cover_image_url" character varying(1000) NOT NULL DEFAULT '', "author_name" character varying(120) NOT NULL DEFAULT '', "tags" text array NOT NULL DEFAULT '{}', "status" character varying(12) NOT NULL DEFAULT 'draft', "published_at" TIMESTAMP WITH TIME ZONE, "seo_title" character varying(200) NOT NULL DEFAULT '', "seo_description" character varying(300) NOT NULL DEFAULT '', "views" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_dd2add25eac93daefc93da9d387" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_ce19055de928eaf8b243faca62" ON "blog_posts" ("site_id", "status", "published_at") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_7f5e7b71b501eeaf617d8c6933" ON "blog_posts" ("site_id", "slug") `);
        await queryRunner.query(`CREATE TABLE "qr_codes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "name" character varying(120) NOT NULL, "code" character varying(16) NOT NULL, "destination" character varying(2000) NOT NULL, "utm" boolean NOT NULL DEFAULT true, "is_active" boolean NOT NULL DEFAULT true, "color" character varying(7) NOT NULL DEFAULT '#000000', "ec_level" character varying(1) NOT NULL DEFAULT 'M', "scans" integer NOT NULL DEFAULT '0', "last_scanned_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_4b7aa338e150a878ce9e2c55c5c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d1ac9402c2bdf996f18461d841" ON "qr_codes" ("workspace_id", "created_at") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_8a8ba2310839f388674c1b095c" ON "qr_codes" ("code") `);
        await queryRunner.query(`CREATE TABLE "qr_scans" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "qr_code_id" uuid NOT NULL, "device" character varying(10) NOT NULL, CONSTRAINT "PK_f43b8280df24c98d0d5ba6db766" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7edd1a6ca4cba1057497931b30" ON "qr_scans" ("qr_code_id", "created_at") `);
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
        await queryRunner.query(`DROP INDEX "public"."IDX_7edd1a6ca4cba1057497931b30"`);
        await queryRunner.query(`DROP TABLE "qr_scans"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8a8ba2310839f388674c1b095c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d1ac9402c2bdf996f18461d841"`);
        await queryRunner.query(`DROP TABLE "qr_codes"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7f5e7b71b501eeaf617d8c6933"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ce19055de928eaf8b243faca62"`);
        await queryRunner.query(`DROP TABLE "blog_posts"`);
    }

}
