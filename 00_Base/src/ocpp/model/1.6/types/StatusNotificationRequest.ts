// Copyright Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache 2.0

 
/**
 * This file was automatically generated by json-schema-to-typescript.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
 * and run json-schema-to-typescript to regenerate this file.
 */

import {
  StatusNotificationRequestErrorCode,
  StatusNotificationRequestStatus,
} from '../enums';
import { OcppRequest } from '../../../..';

export interface StatusNotificationRequest extends OcppRequest {
  connectorId: number;
  errorCode: StatusNotificationRequestErrorCode;
  info?: string | null;
  status: StatusNotificationRequestStatus;
  timestamp?: string | null;
  vendorId?: string | null;
  vendorErrorCode?: string | null;
}
