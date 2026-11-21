import { MigrationInterface, QueryRunner } from "typeorm";

export class PhoneMenusRecording1795242138323 implements MigrationInterface {
    name = 'PhoneMenusRecording1795242138323'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "phone_numbers" ADD "record_calls" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "phone_numbers" ADD "recording_notice" character varying(200) NOT NULL DEFAULT 'This call may be recorded.'`);
        await queryRunner.query(`ALTER TABLE "phone_numbers" ADD "menu_enabled" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "phone_numbers" ADD "menu_prompt" character varying(300) NOT NULL DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE "phone_numbers" ADD "menu_options" jsonb NOT NULL DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "calls" ADD "direction" character varying(8) NOT NULL DEFAULT 'inbound'`);
        await queryRunner.query(`ALTER TABLE "calls" ADD "menu_choice" character varying(40)`);
        await queryRunner.query(`ALTER TABLE "calls" ADD "user_id" uuid`);
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
        await queryRunner.query(`ALTER TABLE "calls" DROP COLUMN "user_id"`);
        await queryRunner.query(`ALTER TABLE "calls" DROP COLUMN "menu_choice"`);
        await queryRunner.query(`ALTER TABLE "calls" DROP COLUMN "direction"`);
        await queryRunner.query(`ALTER TABLE "phone_numbers" DROP COLUMN "menu_options"`);
        await queryRunner.query(`ALTER TABLE "phone_numbers" DROP COLUMN "menu_prompt"`);
        await queryRunner.query(`ALTER TABLE "phone_numbers" DROP COLUMN "menu_enabled"`);
        await queryRunner.query(`ALTER TABLE "phone_numbers" DROP COLUMN "recording_notice"`);
        await queryRunner.query(`ALTER TABLE "phone_numbers" DROP COLUMN "record_calls"`);
    }

}
