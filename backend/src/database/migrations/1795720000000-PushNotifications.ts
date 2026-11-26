import { MigrationInterface, QueryRunner } from "typeorm";

export class PushNotifications1795720000000 implements MigrationInterface {
    name = 'PushNotifications1795720000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "push_subscriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, "user_id" uuid NOT NULL, "endpoint" character varying(1000) NOT NULL, "p256dh" character varying(200) NOT NULL, "auth" character varying(100) NOT NULL, "label" character varying(80) NOT NULL DEFAULT '', "topics" jsonb NOT NULL DEFAULT '[]', "last_sent_at" TIMESTAMP WITH TIME ZONE, "failure_count" integer NOT NULL DEFAULT 0, CONSTRAINT "PK_push_subscriptions" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_push_subscriptions_endpoint" ON "push_subscriptions" ("endpoint") `);
        await queryRunner.query(`CREATE INDEX "IDX_push_subscriptions_user" ON "push_subscriptions" ("user_id") `);
        await queryRunner.query(`ALTER TABLE "push_subscriptions" ADD CONSTRAINT "FK_push_subscriptions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE TABLE "system_settings" ("key" character varying(80) NOT NULL, "value" jsonb NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_system_settings" PRIMARY KEY ("key"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "system_settings"`);
        await queryRunner.query(`ALTER TABLE "push_subscriptions" DROP CONSTRAINT "FK_push_subscriptions_user"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_push_subscriptions_user"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_push_subscriptions_endpoint"`);
        await queryRunner.query(`DROP TABLE "push_subscriptions"`);
    }
}
