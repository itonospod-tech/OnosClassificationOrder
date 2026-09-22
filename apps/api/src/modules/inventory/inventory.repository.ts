import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DatabaseRepositoryAbstract } from 'core';
import { Model } from 'mongoose';

import type { InventoryTransactionDocument } from './inventory-transaction.entity';
import { InventoryTransactionEntity } from './inventory-transaction.entity';

@Injectable()
export class InventoryRepository extends DatabaseRepositoryAbstract<
  InventoryTransactionEntity,
  InventoryTransactionDocument
> {
  constructor(
    @InjectModel(InventoryTransactionEntity.name)
    private readonly txnModel: Model<InventoryTransactionEntity>,
  ) {
    super(txnModel);
  }
}
