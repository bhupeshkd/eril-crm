import { MigrationInterface, QueryRunner } from "typeorm";

export class MessageProviderIndex1795245465791 implements MigrationInterface {
    name = 'MessageProviderIndex1795245465791'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "saas_plans" ALTER COLUMN "limits" SET DEFAULT '{"contacts":null,"users":null}'`);
        await queryRunner.query(`ALTER TABLE "saas_plans" ALTER COLUMN "included" SET DEFAULT '{"emails":0,"sms":0}'`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"recipients":0,"sent":0,"failed":0,"skipped":0}'`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0":[],"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}],"6":[]}'`);
        await queryRunner.query(`CREATE INDEX "IDX_53e8170f736f8b0ad29a5bfa91" ON "messages" ("provider_message_id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_53e8170f736f8b0ad29a5bfa91"`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0": [], "1": [{"end": "17:00", "start": "09:00"}], "2": [{"end": "17:00", "start": "09:00"}], "3": [{"end": "17:00", "start": "09:00"}], "4": [{"end": "17:00", "start": "09:00"}], "5": [{"end": "17:00", "start": "09:00"}], "6": []}'`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"sent": 0, "failed": 0, "skipped": 0, "recipients": 0}'`);
        await queryRunner.query(`ALTER TABLE "saas_plans" ALTER COLUMN "included" SET DEFAULT '{"sms": 0, "emails": 0}'`);
        await queryRunner.query(`ALTER TABLE "saas_plans" ALTER COLUMN "limits" SET DEFAULT '{"users": null, "contacts": null}'`);
    }

}
