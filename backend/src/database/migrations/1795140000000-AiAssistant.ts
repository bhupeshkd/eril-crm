import { MigrationInterface, QueryRunner } from "typeorm";

export class AiAssistant1795140000000 implements MigrationInterface {
    name = 'AiAssistant1795140000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "conversations" ADD "bot_paused" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "conversations" ADD "bot_reply_count" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "conversations" ADD "bot_handoff_reason" character varying(255)`);
        await queryRunner.query(`ALTER TABLE "conversations" ADD "bot_paused_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "messages" ADD "sent_by_bot" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "sent_by_bot"`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "bot_paused_at"`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "bot_handoff_reason"`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "bot_reply_count"`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN "bot_paused"`);
    }
}
