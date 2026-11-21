import { MigrationInterface, QueryRunner } from "typeorm";

export class Upsells1794944297029 implements MigrationInterface {
    name = 'Upsells1794944297029'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "invoices" ADD "parent_invoice_id" uuid`);
        await queryRunner.query(`ALTER TABLE "invoices" ADD "upsell_index" integer`);
        await queryRunner.query(`ALTER TABLE "invoices" ADD "upsell_step" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "invoices" ADD "stripe_customer_id" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "invoices" ADD "stripe_payment_method_id" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "order_forms" ADD "upsells" jsonb NOT NULL DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"recipients":0,"sent":0,"failed":0,"skipped":0}'`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0":[],"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}],"6":[]}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0": [], "1": [{"end": "17:00", "start": "09:00"}], "2": [{"end": "17:00", "start": "09:00"}], "3": [{"end": "17:00", "start": "09:00"}], "4": [{"end": "17:00", "start": "09:00"}], "5": [{"end": "17:00", "start": "09:00"}], "6": []}'`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"sent": 0, "failed": 0, "skipped": 0, "recipients": 0}'`);
        await queryRunner.query(`ALTER TABLE "order_forms" DROP COLUMN "upsells"`);
        await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "stripe_payment_method_id"`);
        await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "stripe_customer_id"`);
        await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "upsell_step"`);
        await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "upsell_index"`);
        await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "parent_invoice_id"`);
    }

}
