import { MigrationInterface, QueryRunner } from "typeorm";

export class OrderForms1794943443710 implements MigrationInterface {
    name = 'OrderForms1794943443710'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "order_forms" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "name" character varying(255) NOT NULL, "slug" character varying(120) NOT NULL, "headline" character varying(255) NOT NULL DEFAULT '', "description" text NOT NULL DEFAULT '', "product_ids" uuid array NOT NULL DEFAULT '{}', "bump" jsonb, "collect_phone" boolean NOT NULL DEFAULT false, "allow_coupons" boolean NOT NULL DEFAULT true, "tax_rate" numeric(5,2) NOT NULL DEFAULT '0', "tags" text array NOT NULL DEFAULT '{}', "button_label" character varying(60) NOT NULL DEFAULT 'Complete order', "thank_you_message" text NOT NULL DEFAULT 'Thank you for your order!', "redirect_url" character varying(1000) NOT NULL DEFAULT '', "is_active" boolean NOT NULL DEFAULT true, "views" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_8307f75f0385eb632f7c485c795" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_14295f9d1f8f7d146b52930279" ON "order_forms" ("workspace_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_fc0e76e664ba217b9637cd341f" ON "order_forms" ("slug") `);
        await queryRunner.query(`ALTER TABLE "invoices" ADD "order_form_id" uuid`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"recipients":0,"sent":0,"failed":0,"skipped":0}'`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0":[],"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}],"6":[]}'`);
        await queryRunner.query(`CREATE INDEX "IDX_286ac73fdf2550520f365202bd" ON "invoices" ("order_form_id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_286ac73fdf2550520f365202bd"`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0": [], "1": [{"end": "17:00", "start": "09:00"}], "2": [{"end": "17:00", "start": "09:00"}], "3": [{"end": "17:00", "start": "09:00"}], "4": [{"end": "17:00", "start": "09:00"}], "5": [{"end": "17:00", "start": "09:00"}], "6": []}'`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"sent": 0, "failed": 0, "skipped": 0, "recipients": 0}'`);
        await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "order_form_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fc0e76e664ba217b9637cd341f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_14295f9d1f8f7d146b52930279"`);
        await queryRunner.query(`DROP TABLE "order_forms"`);
    }

}
