import { MigrationInterface, QueryRunner } from "typeorm";

export class CalendarSync1795256575044 implements MigrationInterface {
    name = 'CalendarSync1795256575044'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "calendar_feeds" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "user_id" uuid NOT NULL, "token" character varying(64) NOT NULL, CONSTRAINT "PK_045067d8bb57f971f3c5426ea71" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_17d0afe6a50bd6c4a67045e8bb" ON "calendar_feeds" ("workspace_id", "user_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_63fc0fd22c929fae074fcaf601" ON "calendar_feeds" ("token") `);
        await queryRunner.query(`CREATE TABLE "external_calendars" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "user_id" uuid, "calendar_id" uuid, "name" character varying(120) NOT NULL, "url" character varying(2000) NOT NULL, "busy" jsonb NOT NULL DEFAULT '[]', "last_synced_at" TIMESTAMP WITH TIME ZONE, "last_error" character varying(300), CONSTRAINT "PK_5bb0f7b9683a8b92d9d2a68bb58" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_c92b6af992425956e154e221e9" ON "external_calendars" ("workspace_id", "calendar_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_c1559556f1e27645a704a34c6b" ON "external_calendars" ("workspace_id", "user_id") `);
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
        await queryRunner.query(`DROP INDEX "public"."IDX_c1559556f1e27645a704a34c6b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c92b6af992425956e154e221e9"`);
        await queryRunner.query(`DROP TABLE "external_calendars"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_63fc0fd22c929fae074fcaf601"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_17d0afe6a50bd6c4a67045e8bb"`);
        await queryRunner.query(`DROP TABLE "calendar_feeds"`);
    }

}
