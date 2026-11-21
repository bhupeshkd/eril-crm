import { MigrationInterface, QueryRunner } from "typeorm";

export class Communities1795024554796 implements MigrationInterface {
    name = 'Communities1795024554796'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "communities" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "name" character varying(255) NOT NULL, "slug" character varying(120) NOT NULL, "description" text NOT NULL DEFAULT '', "join_mode" character varying(10) NOT NULL DEFAULT 'invite', "auto_join_course_ids" uuid array NOT NULL DEFAULT '{}', "tags" text array NOT NULL DEFAULT '{}', "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_fea1fe83c86ccde9d0a089e7ea2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e70dcb5a14e6dc02cbc92d55a3" ON "communities" ("workspace_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_42d5225a80ac87aa1254dfe282" ON "communities" ("slug") `);
        await queryRunner.query(`CREATE TABLE "community_channels" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "community_id" uuid NOT NULL, "name" character varying(80) NOT NULL, "description" character varying(255) NOT NULL DEFAULT '', "position" integer NOT NULL DEFAULT '0', "staff_only" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_f0d57b1c4bb9b38deaefb3b3cf1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_03df18d87df03fe36346dcdae0" ON "community_channels" ("community_id", "position") `);
        await queryRunner.query(`CREATE TABLE "community_members" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "community_id" uuid NOT NULL, "contact_id" uuid NOT NULL, "access_token" character varying(64) NOT NULL, "display_name" character varying(80) NOT NULL, "role" character varying(12) NOT NULL DEFAULT 'member', "status" character varying(10) NOT NULL DEFAULT 'active', "source" character varying(12) NOT NULL DEFAULT 'staff', "last_seen_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_03dff82f9cfcb02498e9f5fc640" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_037dd807cc928eba96627b9bbd" ON "community_members" ("access_token") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_fffd04fc0fc04cb2343aae907a" ON "community_members" ("community_id", "contact_id") `);
        await queryRunner.query(`CREATE TABLE "community_posts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "community_id" uuid NOT NULL, "channel_id" uuid NOT NULL, "member_id" uuid, "author_user_id" uuid, "body" text NOT NULL, "pinned" boolean NOT NULL DEFAULT false, "hidden" boolean NOT NULL DEFAULT false, "like_count" integer NOT NULL DEFAULT '0', "comment_count" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_af0c0b33e03b933e3e48119f2e3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_b3619d9abd2516ec4909fe852c" ON "community_posts" ("community_id", "channel_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "community_comments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "post_id" uuid NOT NULL, "member_id" uuid, "author_user_id" uuid, "body" text NOT NULL, "hidden" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_bddaf18297fe4a6d1cd539586b3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_fa9f443425b4d5c0b0ffc8a01d" ON "community_comments" ("post_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "community_likes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "post_id" uuid NOT NULL, "member_id" uuid, "user_id" uuid, CONSTRAINT "PK_6108c3fd46738fe8a1e387b5d72" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_34cac051b2e366a21b8450f32d" ON "community_likes" ("post_id", "user_id") WHERE "user_id" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_007a7a4aa6804e9630df53f861" ON "community_likes" ("post_id", "member_id") WHERE "member_id" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"recipients":0,"sent":0,"failed":0,"skipped":0}'`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0":[],"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}],"6":[]}'`);
        await queryRunner.query(`ALTER TABLE "community_members" ADD CONSTRAINT "FK_596fb35d1d22b1cd07dc1e2e4fc" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "community_members" DROP CONSTRAINT "FK_596fb35d1d22b1cd07dc1e2e4fc"`);
        await queryRunner.query(`ALTER TABLE "calendars" ALTER COLUMN "availability" SET DEFAULT '{"0": [], "1": [{"end": "17:00", "start": "09:00"}], "2": [{"end": "17:00", "start": "09:00"}], "3": [{"end": "17:00", "start": "09:00"}], "4": [{"end": "17:00", "start": "09:00"}], "5": [{"end": "17:00", "start": "09:00"}], "6": []}'`);
        await queryRunner.query(`ALTER TABLE "campaigns" ALTER COLUMN "stats" SET DEFAULT '{"sent": 0, "failed": 0, "skipped": 0, "recipients": 0}'`);
        await queryRunner.query(`DROP INDEX "public"."IDX_007a7a4aa6804e9630df53f861"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_34cac051b2e366a21b8450f32d"`);
        await queryRunner.query(`DROP TABLE "community_likes"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fa9f443425b4d5c0b0ffc8a01d"`);
        await queryRunner.query(`DROP TABLE "community_comments"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b3619d9abd2516ec4909fe852c"`);
        await queryRunner.query(`DROP TABLE "community_posts"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fffd04fc0fc04cb2343aae907a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_037dd807cc928eba96627b9bbd"`);
        await queryRunner.query(`DROP TABLE "community_members"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_03df18d87df03fe36346dcdae0"`);
        await queryRunner.query(`DROP TABLE "community_channels"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_42d5225a80ac87aa1254dfe282"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e70dcb5a14e6dc02cbc92d55a3"`);
        await queryRunner.query(`DROP TABLE "communities"`);
    }

}
