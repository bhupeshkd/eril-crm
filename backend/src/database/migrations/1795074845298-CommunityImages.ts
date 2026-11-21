import { MigrationInterface, QueryRunner } from "typeorm";

export class CommunityImages1795074845298 implements MigrationInterface {
    name = 'CommunityImages1795074845298'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "community_images" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "community_id" uuid NOT NULL, "post_id" uuid, "uploader_member_id" uuid, "uploader_user_id" uuid, "mime" character varying(20) NOT NULL, "size" integer NOT NULL, "position" integer NOT NULL DEFAULT '0', "data" bytea NOT NULL, CONSTRAINT "PK_d40ed3fe66272ce4254337f972a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_860d836a2c5ed5d5913dc91321" ON "community_images" ("community_id", "created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_a5aedb873ab9fa2eb41d9c783b" ON "community_images" ("post_id", "position") `);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"recipients":0,"sent":0,"failed":0,"skipped":0}'`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0":[],"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}],"6":[]}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0": [], "1": [{"end": "17:00", "start": "09:00"}], "2": [{"end": "17:00", "start": "09:00"}], "3": [{"end": "17:00", "start": "09:00"}], "4": [{"end": "17:00", "start": "09:00"}], "5": [{"end": "17:00", "start": "09:00"}], "6": []}'`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"sent": 0, "failed": 0, "skipped": 0, "recipients": 0}'`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a5aedb873ab9fa2eb41d9c783b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_860d836a2c5ed5d5913dc91321"`);
        await queryRunner.query(`DROP TABLE "community_images"`);
    }

}
