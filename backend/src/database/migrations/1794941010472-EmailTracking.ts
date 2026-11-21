import { MigrationInterface, QueryRunner } from "typeorm";

export class EmailTracking1794941010472 implements MigrationInterface {
    name = 'EmailTracking1794941010472'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "email_clicks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "message_id" uuid NOT NULL, "campaign_id" uuid, "url" character varying(2000) NOT NULL, "is_bot" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_4359a8628cf6135ca4a715a5b03" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_155488b47330d375e44063cd65" ON "email_clicks" ("workspace_id", "created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_f924ce48065bfaae69c8632766" ON "email_clicks" ("message_id") `);
        await queryRunner.query(`ALTER TABLE "messages" ADD "tracking_token" character varying(32)`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "campaign_id" uuid`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "opened_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "open_count" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "clicked_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "click_count" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"recipients":0,"sent":0,"failed":0,"skipped":0}'`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0":[],"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}],"6":[]}'`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_758917019fe4596e779d3c131a" ON "messages" ("tracking_token") WHERE "tracking_token" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_7ee9933e7f3d3f6c5a4cfeb154" ON "messages" ("campaign_id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_7ee9933e7f3d3f6c5a4cfeb154"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_758917019fe4596e779d3c131a"`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0": [], "1": [{"end": "17:00", "start": "09:00"}], "2": [{"end": "17:00", "start": "09:00"}], "3": [{"end": "17:00", "start": "09:00"}], "4": [{"end": "17:00", "start": "09:00"}], "5": [{"end": "17:00", "start": "09:00"}], "6": []}'`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"sent": 0, "failed": 0, "skipped": 0, "recipients": 0}'`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "click_count"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "clicked_at"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "open_count"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "opened_at"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "campaign_id"`);
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "tracking_token"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f924ce48065bfaae69c8632766"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_155488b47330d375e44063cd65"`);
        await queryRunner.query(`DROP TABLE "email_clicks"`);
    }

}
