import { MigrationInterface, QueryRunner } from "typeorm";

export class CoursesAgency1794830541034 implements MigrationInterface {
    name = 'CoursesAgency1794830541034'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "courses" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "title" character varying(255) NOT NULL, "description" text NOT NULL DEFAULT '', "cover_image" character varying(1000) NOT NULL DEFAULT '', "modules" jsonb NOT NULL DEFAULT '[]', "is_published" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_3f70a487cc718ad8eda4e6d58c9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_6eead6e87120372c1632159cab" ON "courses" ("workspace_id") `);
        await queryRunner.query(`CREATE TABLE "enrollments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "course_id" uuid NOT NULL, "contact_id" uuid NOT NULL, "access_token" character varying(64) NOT NULL, "completed_lesson_ids" text array NOT NULL DEFAULT '{}', "last_accessed_at" TIMESTAMP WITH TIME ZONE, "completed_at" TIMESTAMP WITH TIME ZONE, "revoked_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_7c0f752f9fb68bf6ed7367ab00f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_5b30bd31295c68f6edce172aa7" ON "enrollments" ("access_token") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_88283ec73f15e810ec8362dde5" ON "enrollments" ("course_id", "contact_id") WHERE "deleted_at" IS NULL`);
        await queryRunner.query(`CREATE TABLE "snapshots" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "organization_id" uuid NOT NULL, "name" character varying(255) NOT NULL, "source_workspace_id" uuid, "content" jsonb NOT NULL, "summary" jsonb NOT NULL DEFAULT '{}', CONSTRAINT "PK_f5661b5fd4224d23e26a631986b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3b03291ada4d6a2d2d187b5f3b" ON "snapshots" ("organization_id") `);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"recipients":0,"sent":0,"failed":0,"skipped":0}'`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0":[],"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}],"6":[]}'`);
        await queryRunner.query(`ALTER TABLE "enrollments" ADD CONSTRAINT "FK_b79d0bf01779fdf9cfb6b092af3" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "enrollments" ADD CONSTRAINT "FK_f03cab2ead5fb38b393bcee0500" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "enrollments" DROP CONSTRAINT "FK_f03cab2ead5fb38b393bcee0500"`);
        await queryRunner.query(`ALTER TABLE "enrollments" DROP CONSTRAINT "FK_b79d0bf01779fdf9cfb6b092af3"`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0": [], "1": [{"end": "17:00", "start": "09:00"}], "2": [{"end": "17:00", "start": "09:00"}], "3": [{"end": "17:00", "start": "09:00"}], "4": [{"end": "17:00", "start": "09:00"}], "5": [{"end": "17:00", "start": "09:00"}], "6": []}'`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"sent": 0, "failed": 0, "skipped": 0, "recipients": 0}'`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3b03291ada4d6a2d2d187b5f3b"`);
        await queryRunner.query(`DROP TABLE "snapshots"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_88283ec73f15e810ec8362dde5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5b30bd31295c68f6edce172aa7"`);
        await queryRunner.query(`DROP TABLE "enrollments"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6eead6e87120372c1632159cab"`);
        await queryRunner.query(`DROP TABLE "courses"`);
    }

}
