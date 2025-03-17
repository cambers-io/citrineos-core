// Copyright Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache 2.0

/**
 * This file was automatically generated by json-schema-to-typescript.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
 * and run json-schema-to-typescript to regenerate this file.
 */

import { SendLocalListRequestStatus, SendLocalListRequestUpdateType } from '../enums';
import { OcppRequest } from '../../../..';

export interface SendLocalListRequest extends OcppRequest {
  listVersion: number;
  localAuthorizationList?: {
    idTag: string | null;
    idTagInfo?: {
      expiryDate?: string | null;
      parentIdTag?: string | null;
      status: SendLocalListRequestStatus;
    };
  }[];
  updateType: SendLocalListRequestUpdateType;
}
