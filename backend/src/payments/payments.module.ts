import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Coupon, Invoice, Product, Subscription } from '../database/entities/payment.entity';
import { Contact } from '../database/entities/contact.entity';
import { OrderForm } from '../database/entities/order-form.entity';
import { CrmModule } from '../crm/crm.module';
import { OrderFormsController, OrderFormsService, PublicOrderFormsController } from './order-forms';
import { TextToPayController, TextToPayService } from './text-to-pay';
import { CommunicationModule } from '../communication/communication.module';
import { PaymentsController, PaymentsService, PublicInvoicesController } from './payments';
import { CouponsService } from './coupons';
import { BillingController, BillingOpsController, SubscriptionsService } from './subscriptions';

@Module({
  imports: [TypeOrmModule.forFeature([Product, Invoice, Contact, Coupon, Subscription, OrderForm]), CommunicationModule, CrmModule],
  // BillingController first: its /payments/subscriptions|coupons routes are static.
  controllers: [BillingController, BillingOpsController, OrderFormsController, TextToPayController, PaymentsController, PublicInvoicesController, PublicOrderFormsController],
  providers: [PaymentsService, CouponsService, SubscriptionsService, OrderFormsService, TextToPayService],
  exports: [PaymentsService, SubscriptionsService],
})
export class PaymentsModule {}
