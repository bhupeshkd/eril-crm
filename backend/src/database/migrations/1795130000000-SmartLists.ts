import { MigrationInterface, QueryRunner } from "typeorm";

export class SmartLists1795130000000 implements MigrationInterface {
    name = 'SmartLists1795130000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "smart_lists" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "workspace_id" uuid NOT NULL, "name" character varying(80) NOT NULL, "filters" jsonb NOT NULL DEFAULT '{}', "created_by" uuid, CONSTRAINT "PK_smart_lists_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_smart_lists_workspace" ON "smart_lists" ("workspace_id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_smart_lists_workspace"`);
        await queryRunner.query(`DROP TABLE "smart_lists"`);
    }
}
