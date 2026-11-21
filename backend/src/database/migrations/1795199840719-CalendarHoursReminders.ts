import { MigrationInterface, QueryRunner } from "typeorm";

export class CalendarHoursReminders1795199840719 implements MigrationInterface {
    name = 'CalendarHoursReminders1795199840719'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "member_hours" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "user_id" uuid NOT NULL, "timezone" character varying(64) NOT NULL DEFAULT 'UTC', "weekly" jsonb NOT NULL, "days_off" text array NOT NULL DEFAULT '{}', CONSTRAINT "PK_1b094b64fe5c83e076ab71a4cfe" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_6064d9711d1d96399e288e4aa6" ON "member_hours" ("workspace_id", "user_id") `);
        await queryRunner.query(`CREATE TABLE "appointment_reminders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "appointment_id" uuid NOT NULL, "key" character varying(80) NOT NULL, "channel" character varying(10) NOT NULL, "status" character varying(10) NOT NULL DEFAULT 'sent', "detail" character varying(300), CONSTRAINT "PK_a6128daa14ae7146de0a1ec4119" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_7fdb04e9f87af8dc26be60ef10" ON "appointment_reminders" ("appointment_id", "key") `);
        await queryRunner.query(`ALTER TABLE "calendars" ADD "reminders" jsonb NOT NULL DEFAULT '[]'`);
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
        await queryRunner.query(`ALTER TABLE "calendars" DROP COLUMN "reminders"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7fdb04e9f87af8dc26be60ef10"`);
        await queryRunner.query(`DROP TABLE "appointment_reminders"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6064d9711d1d96399e288e4aa6"`);
        await queryRunner.query(`DROP TABLE "member_hours"`);
    }

}
