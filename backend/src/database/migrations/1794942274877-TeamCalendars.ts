import { MigrationInterface, QueryRunner } from "typeorm";

export class TeamCalendars1794942274877 implements MigrationInterface {
    name = 'TeamCalendars1794942274877'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "calendars" ADD "type" character varying(20) NOT NULL DEFAULT 'personal'`);
        await queryRunner.query(`ALTER TABLE "calendars" ADD "team_member_ids" uuid array NOT NULL DEFAULT '{}'`);
        await queryRunner.query(`ALTER TABLE "calendars" ADD "distribution" character varying(20) NOT NULL DEFAULT 'round_robin'`);
        await queryRunner.query(`ALTER TABLE "calendars" ADD "assign_contact_owner" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "appointments" ADD "assigned_user_id" uuid`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"recipients":0,"sent":0,"failed":0,"skipped":0}'`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0":[],"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}],"6":[]}'`);
        await queryRunner.query(`CREATE INDEX "IDX_faa2ba3a39c99a6416de04e723" ON "appointments" ("assigned_user_id", "start_at") `);
        await queryRunner.query(`ALTER TABLE "appointments" ADD CONSTRAINT "FK_f54ed2fd8932561dbfae0e8a48b" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "appointments" DROP CONSTRAINT "FK_f54ed2fd8932561dbfae0e8a48b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_faa2ba3a39c99a6416de04e723"`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0": [], "1": [{"end": "17:00", "start": "09:00"}], "2": [{"end": "17:00", "start": "09:00"}], "3": [{"end": "17:00", "start": "09:00"}], "4": [{"end": "17:00", "start": "09:00"}], "5": [{"end": "17:00", "start": "09:00"}], "6": []}'`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"sent": 0, "failed": 0, "skipped": 0, "recipients": 0}'`);
        await queryRunner.query(`ALTER TABLE "appointments" DROP COLUMN "assigned_user_id"`);
        await queryRunner.query(`ALTER TABLE "calendars" DROP COLUMN "assign_contact_owner"`);
        await queryRunner.query(`ALTER TABLE "calendars" DROP COLUMN "distribution"`);
        await queryRunner.query(`ALTER TABLE "calendars" DROP COLUMN "team_member_ids"`);
        await queryRunner.query(`ALTER TABLE "calendars" DROP COLUMN "type"`);
    }

}
