import { MigrationInterface, QueryRunner } from "typeorm";

export class Advanced1794828633274 implements MigrationInterface {
    name = 'Advanced1794828633274'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "sites" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "name" character varying(255) NOT NULL, "slug" character varying(120) NOT NULL, "kind" character varying(10) NOT NULL DEFAULT 'website', "theme" jsonb NOT NULL DEFAULT '{}', "pages" jsonb NOT NULL DEFAULT '[]', "is_published" boolean NOT NULL DEFAULT false, "stats" jsonb NOT NULL DEFAULT '{}', CONSTRAINT "PK_4f5eccb1dfde10c9170502595a7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_26503a75e987672fb5af9258cc" ON "sites" ("slug") `);
        await queryRunner.query(`CREATE TABLE "review_requests" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "contact_id" uuid NOT NULL, "token" character varying(64) NOT NULL, "channel" character varying(10) NOT NULL DEFAULT 'email', "status" character varying(12) NOT NULL DEFAULT 'sent', "completed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_01e5bec2adcef1cf498e861f75a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_c7a0c42dbb10176b36511b39dc" ON "review_requests" ("token") `);
        await queryRunner.query(`CREATE TABLE "reviews" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "contact_id" uuid, "rating" integer NOT NULL, "comment" text NOT NULL DEFAULT '', "is_public" boolean NOT NULL DEFAULT false, "request_id" uuid, "reply" text, CONSTRAINT "PK_231ae565c273ee700b283f15c1d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_a8f68205578ec8bef2ab322749" ON "reviews" ("workspace_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "webhook_subscriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "url" character varying(1000) NOT NULL, "events" text array NOT NULL DEFAULT '{}', "secret" character varying(80) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "last_status" character varying(120), "last_delivered_at" TIMESTAMP WITH TIME ZONE, "failure_count" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_bf631ae77d39849d599817fb6f4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "api_keys" ADD "role" character varying(40) NOT NULL DEFAULT 'workspace_admin'`);
        await queryRunner.query(`ALTER TABLE "api_keys" ADD "created_by" uuid`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"recipients":0,"sent":0,"failed":0,"skipped":0}'`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0":[],"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}],"6":[]}'`);
        await queryRunner.query(`ALTER TABLE "review_requests" ADD CONSTRAINT "FK_8b35247eeeb967f916095be057b" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "reviews" ADD CONSTRAINT "FK_ea7868d60728a5912b1e229fbad" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "reviews" DROP CONSTRAINT "FK_ea7868d60728a5912b1e229fbad"`);
        await queryRunner.query(`ALTER TABLE "review_requests" DROP CONSTRAINT "FK_8b35247eeeb967f916095be057b"`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0": [], "1": [{"end": "17:00", "start": "09:00"}], "2": [{"end": "17:00", "start": "09:00"}], "3": [{"end": "17:00", "start": "09:00"}], "4": [{"end": "17:00", "start": "09:00"}], "5": [{"end": "17:00", "start": "09:00"}], "6": []}'`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"sent": 0, "failed": 0, "skipped": 0, "recipients": 0}'`);
        await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN "created_by"`);
        await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN "role"`);
        await queryRunner.query(`DROP TABLE "webhook_subscriptions"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a8f68205578ec8bef2ab322749"`);
        await queryRunner.query(`DROP TABLE "reviews"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c7a0c42dbb10176b36511b39dc"`);
        await queryRunner.query(`DROP TABLE "review_requests"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_26503a75e987672fb5af9258cc"`);
        await queryRunner.query(`DROP TABLE "sites"`);
    }

}
