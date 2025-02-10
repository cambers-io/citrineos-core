// Copyright Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache 2.0

import { OCPP2_0_1_Namespace, OCPP2_0_1 } from '@citrineos/base';
import { BelongsTo, BelongsToMany, Column, DataType, ForeignKey, HasMany, Model, PrimaryKey, Table } from 'sequelize-typescript';
import { Location } from './Location';
import { StatusNotification } from './StatusNotification';
import { ChargingStationNetworkProfile } from './ChargingStationNetworkProfile';
import { SetNetworkProfile } from './SetNetworkProfile';

/**
 * Represents a charging station.
 * Currently, this data model is internal to CitrineOS. In the future, it will be analogous to an OCPI ChargingStation.
 */
@Table
export class ChargingStation extends Model {
  static readonly MODEL_NAME: string = OCPP2_0_1_Namespace.ChargingStation;

  @PrimaryKey
  @Column(DataType.STRING(36))
  declare id: string;

  @Column
  declare isOnline: boolean;

  @ForeignKey(() => Location)
  @Column(DataType.INTEGER)
  declare locationId?: number | null;

  @HasMany(() => StatusNotification)
  declare statusNotifications?: OCPP2_0_1.StatusNotificationRequest[];

  /**
   * The business Location of the charging station. Optional in case a charging station is not yet in the field, or retired.
   */
  @BelongsTo(() => Location)
  declare location?: Location;

  @BelongsToMany(() => SetNetworkProfile, () => ChargingStationNetworkProfile)
  declare networkProfiles?: SetNetworkProfile[] | null;
}
