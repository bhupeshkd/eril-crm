import { MigrationInterface, QueryRunner } from "typeorm";

export class SubscriptionsCoupons1794892813741 implements MigrationInterface {
    name = 'SubscriptionsCoupons1794892813741'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "coupons" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "code" character varying(40) NOT NULL, "type" character varying(10) NOT NULL, "amount" numeric(15,2) NOT NULL, "currency" character varying(3), "duration" character varying(10) NOT NULL DEFAULT 'once', "duration_cycles" integer, "applies_to" character varying(15) NOT NULL DEFAULT 'all', "max_redemptions" integer, "redemptions" integer NOT NULL DEFAULT '0', "expires_at" TIMESTAMP WITH TIME ZONE, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_d7ea8864a0150183770f3e9a8cb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_d69fd239228687752db36aa415" ON "coupons" ("workspace_id", "code") WHERE "deleted_at" IS NULL`);
        await queryRunner.query(`CREATE TABLE "subscriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "contact_id" uuid NOT NULL, "product_id" uuid, "name" character varying(255) NOT NULL, "price" numeric(15,2) NOT NULL, "quantity" integer NOT NULL DEFAULT '1', "currency" character varying(3) NOT NULL DEFAULT 'USD', "interval" character varying(5) NOT NULL, "tax_rate" numeric(5,2) NOT NULL DEFAULT '0', "status" character varying(10) NOT NULL DEFAULT 'active', "coupon_id" uuid, "coupon_cycles_remaining" integer, "days_until_due" integer NOT NULL DEFAULT '7', "anchor_day" integer NOT NULL, "current_period_start" TIMESTAMP WITH TIME ZONE, "current_period_end" TIMESTAMP WITH TIME ZONE, "next_billing_at" TIMESTAMP WITH TIME ZONE, "cancel_at_period_end" boolean NOT NULL DEFAULT false, "canceled_at" TIMESTAMP WITH TIME ZONE, "cycles_billed" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_a87248d73155605cf782be9ee5e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e02d27a32bbd68801f1b993212" ON "subscriptions" ("status", "next_billing_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_4c3fc1140c97222d76b639181d" ON "subscriptions" ("workspace_id", "status") `);
        await queryRunner.query(`ALTER TABLE "invoices" ADD "coupon_code" character varying(40)`);
        await queryRunner.query(`ALTER TABLE "invoices" ADD "subscription_id" uuid`);
        await queryRunner.query(`ALTER TABLE "invoices" ADD "overdue_notified_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0":[],"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}],"6":[]}'`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"recipients":0,"sent":0,"failed":0,"skipped":0}'`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD CONSTRAINT "FK_77586042e6b6780d26266ba847c" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "subscriptions" DROP CONSTRAINT "FK_77586042e6b6780d26266ba847c"`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"sent": 0, "failed": 0, "skipped": 0, "recipients": 0}'`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0": [], "1": [{"end": "17:00", "start": "09:00"}], "2": [{"end": "17:00", "start": "09:00"}], "3": [{"end": "17:00", "start": "09:00"}], "4": [{"end": "17:00", "start": "09:00"}], "5": [{"end": "17:00", "start": "09:00"}], "6": []}'`);
        await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "overdue_notified_at"`);
        await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "subscription_id"`);
        await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "coupon_code"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4c3fc1140c97222d76b639181d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e02d27a32bbd68801f1b993212"`);
        await queryRunner.query(`DROP TABLE "subscriptions"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d69fd239228687752db36aa415"`);
        await queryRunner.query(`DROP TABLE "coupons"`);
    }

}
