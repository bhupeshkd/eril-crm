import { MigrationInterface, QueryRunner } from "typeorm";

export class TextToPay1795078358964 implements MigrationInterface {
    name = 'TextToPay1795078358964'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "invoices" ADD "source" character varying(20)`);
        await queryRunner.query(`ALTER TABLE "invoices" ADD "request_channel" character varying(5)`);
        await queryRunner.query(`ALTER TABLE "invoices" ADD "receipt_sent_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"recipients":0,"sent":0,"failed":0,"skipped":0}'`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0":[],"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}],"6":[]}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0": [], "1": [{"end": "17:00", "start": "09:00"}], "2": [{"end": "17:00", "start": "09:00"}], "3": [{"end": "17:00", "start": "09:00"}], "4": [{"end": "17:00", "start": "09:00"}], "5": [{"end": "17:00", "start": "09:00"}], "6": []}'`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"sent": 0, "failed": 0, "skipped": 0, "recipients": 0}'`);
        await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "receipt_sent_at"`);
        await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "request_channel"`);
        await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN "source"`);
    }

}
