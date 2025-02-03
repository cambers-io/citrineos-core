// Copyright (c) 2023 S44, LLC
// Copyright Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache 2.0

import { ILogObj, Logger } from 'tslog';
import { IMonitoringModuleApi } from './interface';
import { MonitoringModule } from './module';
import {
  Component,
  CreateOrUpdateVariableAttributeQuerySchema,
  CreateOrUpdateVariableAttributeQuerystring,
  sequelize,
  Variable,
  VariableAttributeQuerySchema,
  VariableAttributeQuerystring,
} from '@citrineos/data';
import {
  AbstractModuleApi,
  AsDataEndpoint,
  AsMessageEndpoint,
  CallAction,
  HttpMethod,
  IMessageConfirmation,
  Namespace,
  OCPP2_0_1,
  OCPP2_0_1_CallAction,
  OCPPVersion,
  ReportDataTypeSchema,
} from '@citrineos/base';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { getBatches, getSizeOfRequest } from '@citrineos/util';

/**
 * Server API for the Monitoring module.
 */
export class MonitoringModuleApi
  extends AbstractModuleApi<MonitoringModule>
  implements IMonitoringModuleApi
{
  private readonly _componentMonitoringCtrlr = 'MonitoringCtrlr';
  private readonly _componentDeviceDataCtrlr = 'DeviceDataCtrlr';

  /**
   * Constructor for the class.
   *
   * @param {MonitoringModule} monitoringModule - The monitoring module.
   * @param {FastifyInstance} server - The server instance.
   * @param {Logger<ILogObj>} [logger] - The logger instance.
   */
  constructor(
    monitoringModule: MonitoringModule,
    server: FastifyInstance,
    logger?: Logger<ILogObj>,
  ) {
    super(monitoringModule, server, logger);
  }

  /**
   * Message Endpoints
   */

  @AsMessageEndpoint(
    OCPP2_0_1_CallAction.SetVariableMonitoring,
    OCPP2_0_1.SetVariableMonitoringRequestSchema,
  )
  async setVariableMonitoring(
    identifier: string[],
    tenantId: string,
    request: OCPP2_0_1.SetVariableMonitoringRequest,
    callbackUrl?: string,
  ): Promise<IMessageConfirmation[]> {
    // For each station, check request size, process monitoring data, and handle batch sending
    const confirmations: IMessageConfirmation[] = [];

    for (const id of identifier) {
      try {
        // Request size check
        const maxBytes =
          await this._module._deviceModelService.getBytesPerMessageByComponentAndVariableInstanceAndStationId(
            this._componentMonitoringCtrlr,
            OCPP2_0_1_CallAction.SetVariableMonitoring,
            id,
          );
        const requestBytes = getSizeOfRequest(request);

        if (maxBytes && requestBytes > maxBytes) {
          throw new Error(
            `The request size exceeds the limit of ${maxBytes} bytes for identifier ${id}.`,
          );
        }

        const setMonitoringData =
          request.setMonitoringData as OCPP2_0_1.SetMonitoringDataType[];
        // For each monitoring data record, do any needed adjustments or DB upserts
        for (const data of setMonitoringData) {
          const [component, variable] =
            await this._module.deviceModelRepository.findComponentAndVariable(
              data.component,
              data.variable,
            );

          // If Monitor is 'Delta' and variable is not numeric, set monitorValue to 1
          if (
            data.type === OCPP2_0_1.MonitorEnumType.Delta &&
            variable?.variableCharacteristics?.dataType !==
              OCPP2_0_1.DataEnumType.decimal &&
            variable?.variableCharacteristics?.dataType !==
              OCPP2_0_1.DataEnumType.integer
          ) {
            data.value = 1;
            this._logger.debug('Updated SetMonitoringData value to 1', data);
          }

          if (component && variable) {
            await this._module.variableMonitoringRepository.createOrUpdateBySetMonitoringDataTypeAndStationId(
              data,
              component.id,
              variable.id,
              id,
            );
          }
        }

        // Determine how many items to send per message
        const itemsPerMessage =
          (await this._module._deviceModelService.getItemsPerMessageByComponentAndVariableInstanceAndStationId(
            this._componentMonitoringCtrlr,
            OCPP2_0_1_CallAction.SetVariableMonitoring,
            id,
          )) ?? setMonitoringData.length;

        // Split up the setMonitoringData into batches and call sendCall for each
        const result = await this.processBatches(
          id,
          tenantId,
          OCPPVersion.OCPP2_0_1,
          OCPP2_0_1_CallAction.SetVariableMonitoring,
          { setMonitoringData },
          'setMonitoringData',
          itemsPerMessage,
          callbackUrl,
        );
        confirmations.push(...result);
      } catch (error) {
        confirmations.push({
          success: false,
          payload: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return confirmations;
  }

  @AsMessageEndpoint(
    OCPP2_0_1_CallAction.ClearVariableMonitoring,
    OCPP2_0_1.ClearVariableMonitoringRequestSchema,
  )
  async clearVariableMonitoring(
    identifier: string[],
    tenantId: string,
    request: OCPP2_0_1.ClearVariableMonitoringRequest,
    callbackUrl?: string,
  ): Promise<IMessageConfirmation[]> {
    const confirmations: IMessageConfirmation[] = [];

    for (const id of identifier) {
      try {
        this._logger.debug(
          'ClearVariableMonitoring request received for station',
          id,
          request,
        );

        // Request size check
        const maxBytes =
          await this._module._deviceModelService.getBytesPerMessageByComponentAndVariableInstanceAndStationId(
            this._componentMonitoringCtrlr,
            OCPP2_0_1_CallAction.ClearVariableMonitoring,
            id,
          );
        const requestBytes = getSizeOfRequest(request);

        if (maxBytes && requestBytes > maxBytes) {
          throw new Error(
            `The request size exceeds the limit of ${maxBytes} bytes for identifier ${id}.`,
          );
        }

        const ids = request.id as number[];
        // Determine how many items to send per message
        const itemsPerMessage =
          (await this._module._deviceModelService.getItemsPerMessageByComponentAndVariableInstanceAndStationId(
            this._componentMonitoringCtrlr,
            OCPP2_0_1_CallAction.ClearVariableMonitoring,
            id,
          )) ?? ids.length;

        // Batches
        const result = await this.processBatches(
          id,
          tenantId,
          OCPPVersion.OCPP2_0_1,
          OCPP2_0_1_CallAction.ClearVariableMonitoring,
          { id: ids },
          'id',
          itemsPerMessage,
          callbackUrl,
        );
        confirmations.push(...result);
      } catch (error) {
        confirmations.push({
          success: false,
          payload: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return confirmations;
  }

  @AsMessageEndpoint(
    OCPP2_0_1_CallAction.SetMonitoringLevel,
    OCPP2_0_1.SetMonitoringLevelRequestSchema,
  )
  setMonitoringLevel(
    identifier: string[],
    tenantId: string,
    request: OCPP2_0_1.SetMonitoringLevelRequest,
    callbackUrl?: string,
  ): Promise<IMessageConfirmation[]> {
    const results = identifier.map((id) =>
      this._module.sendCall(
        id,
        tenantId,
        OCPPVersion.OCPP2_0_1,
        OCPP2_0_1_CallAction.SetMonitoringLevel,
        request,
        callbackUrl,
      ),
    );
    return Promise.all(results);
  }

  @AsMessageEndpoint(
    OCPP2_0_1_CallAction.SetMonitoringBase,
    OCPP2_0_1.SetMonitoringBaseRequestSchema,
  )
  setMonitoringBase(
    identifier: string[],
    tenantId: string,
    request: OCPP2_0_1.SetMonitoringBaseRequest,
    callbackUrl?: string,
  ): Promise<IMessageConfirmation[]> {
    const results = identifier.map((id) =>
      this._module.sendCall(
        id,
        tenantId,
        OCPPVersion.OCPP2_0_1,
        OCPP2_0_1_CallAction.SetMonitoringBase,
        request,
        callbackUrl,
      ),
    );
    return Promise.all(results);
  }

  @AsMessageEndpoint(
    OCPP2_0_1_CallAction.SetVariables,
    OCPP2_0_1.SetVariablesRequestSchema,
  )
  async setVariables(
    identifier: string[],
    tenantId: string,
    request: OCPP2_0_1.SetVariablesRequest,
    callbackUrl?: string,
  ): Promise<IMessageConfirmation[]> {
    const confirmations: IMessageConfirmation[] = [];

    for (const id of identifier) {
      try {
        const setVariableData =
          request.setVariableData as OCPP2_0_1.SetVariableDataType[];

        // Store variable data in local DB so that the response can find them
        await this._module.deviceModelRepository.createOrUpdateBySetVariablesDataAndStationId(
          setVariableData,
          id,
          new Date().toISOString(),
        );

        // Determine how many items to send per message
        const itemsPerMessage =
          (await this._module._deviceModelService.getItemsPerMessageByComponentAndVariableInstanceAndStationId(
            this._componentDeviceDataCtrlr,
            OCPP2_0_1_CallAction.SetVariables,
            id,
          )) ?? setVariableData.length;

        // Batches
        const result = await this.processBatches(
          id,
          tenantId,
          OCPPVersion.OCPP2_0_1,
          OCPP2_0_1_CallAction.SetVariables,
          { setVariableData },
          'setVariableData',
          itemsPerMessage,
          callbackUrl,
        );
        confirmations.push(...result);
      } catch (error) {
        confirmations.push({
          success: false,
          payload: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return confirmations;
  }

  @AsMessageEndpoint(
    OCPP2_0_1_CallAction.GetVariables,
    OCPP2_0_1.GetVariablesRequestSchema,
  )
  async getVariables(
    identifier: string[],
    tenantId: string,
    request: OCPP2_0_1.GetVariablesRequest,
    callbackUrl?: string,
  ): Promise<IMessageConfirmation[]> {
    const confirmations: IMessageConfirmation[] = [];

    for (const id of identifier) {
      try {
        // Request size check
        const maxBytes =
          await this._module._deviceModelService.getBytesPerMessageByComponentAndVariableInstanceAndStationId(
            this._componentDeviceDataCtrlr,
            OCPP2_0_1_CallAction.GetVariables,
            id,
          );
        const requestBytes = getSizeOfRequest(request);

        if (maxBytes && requestBytes > maxBytes) {
          throw new Error(
            `The request size exceeds the limit of ${maxBytes} bytes for identifier ${id}.`,
          );
        }

        const getVariableData =
          request.getVariableData as OCPP2_0_1.GetVariableDataType[];

        // Determine how many items to send per message
        const itemsPerMessage =
          (await this._module._deviceModelService.getItemsPerMessageByComponentAndVariableInstanceAndStationId(
            this._componentDeviceDataCtrlr,
            OCPP2_0_1_CallAction.GetVariables,
            id,
          )) ?? getVariableData.length;

        // Batches
        const result = await this.processBatches(
          id,
          tenantId,
          OCPPVersion.OCPP2_0_1,
          OCPP2_0_1_CallAction.GetVariables,
          { getVariableData },
          'getVariableData',
          itemsPerMessage,
          callbackUrl,
        );
        confirmations.push(...result);
      } catch (error) {
        confirmations.push({
          success: false,
          payload: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return confirmations;
  }

  /**
   * Data Endpoints
   */

  @AsDataEndpoint(
    Namespace.VariableAttributeType,
    HttpMethod.Put,
    CreateOrUpdateVariableAttributeQuerySchema,
    ReportDataTypeSchema,
  )
  async putDeviceModelVariables(
    request: FastifyRequest<{
      Body: OCPP2_0_1.ReportDataType;
      Querystring: CreateOrUpdateVariableAttributeQuerystring;
    }>,
  ): Promise<sequelize.VariableAttribute[]> {
    // fill in default values where omitted
    for (const variableAttr of request.body.variableAttribute) {
      if (!variableAttr.mutability) {
        variableAttr.mutability = OCPP2_0_1.MutabilityEnumType.ReadWrite;
      }
    }
    const timestamp = new Date().toISOString();
    const variableAttributes =
      await this._module.deviceModelRepository.createOrUpdateDeviceModelByStationId(
        request.body,
        request.query.stationId,
        timestamp,
      );

    if (request.query.setOnCharger) {
      // Mark them as Accepted (set on the charger outside of OCPP communication)
      for (let variableAttribute of variableAttributes) {
        variableAttribute = await variableAttribute.reload({
          include: [Variable, Component],
        });
        await this._module.deviceModelRepository.updateResultByStationId(
          {
            attributeType: variableAttribute.type,
            attributeStatus: OCPP2_0_1.SetVariableStatusEnumType.Accepted,
            attributeStatusInfo: { reasonCode: 'SetOnCharger' },
            component: variableAttribute.component,
            variable: variableAttribute.variable,
          },
          request.query.stationId,
          timestamp,
        );
      }
    }
    return variableAttributes;
  }

  @AsDataEndpoint(
    Namespace.VariableAttributeType,
    HttpMethod.Get,
    VariableAttributeQuerySchema,
  )
  getDeviceModelVariables(
    request: FastifyRequest<{ Querystring: VariableAttributeQuerystring }>,
  ): Promise<sequelize.VariableAttribute[] | undefined> {
    return this._module.deviceModelRepository.readAllByQuerystring(
      request.query,
    );
  }

  @AsDataEndpoint(
    Namespace.VariableAttributeType,
    HttpMethod.Delete,
    VariableAttributeQuerySchema,
  )
  deleteDeviceModelVariables(
    request: FastifyRequest<{ Querystring: VariableAttributeQuerystring }>,
  ): Promise<string> {
    return this._module.deviceModelRepository
      .deleteAllByQuerystring(request.query)
      .then(
        (deletedCount) =>
          deletedCount.toString() +
          ' rows successfully deleted from ' +
          Namespace.VariableAttributeType,
      );
  }

  /**
   * Processes data in batches and sends them to the specified OCPP action.
   *
   * @param {string} stationId - The station's identifier.
   * @param {string} tenantId - The tenant identifier.
   * @param {OCPPVersion} version - The OCPP version to use.
   * @param {OCPP2_0_1_CallAction} action - The OCPP 2.0.1 action to call.
   * @param {Record<string, any>} requestData - The request object containing the data array to batch.
   * @param {string} dataKey - The key in `requestData` that contains the array to batch.
   * @param {number} itemsPerMessage - The maximum number of items to include in a single batch message.
   * @param {string} [callbackUrl] - An optional callback URL.
   * @returns {Promise<IMessageConfirmation[]>} - Array of message confirmations for each batch.
   */
  private async processBatches(
    stationId: string,
    tenantId: string,
    version: OCPPVersion,
    action: OCPP2_0_1_CallAction,
    requestData: Record<string, any>,
    dataKey: string,
    itemsPerMessage: number,
    callbackUrl?: string,
  ): Promise<IMessageConfirmation[]> {
    const confirmations: IMessageConfirmation[] = [];
    const allData = requestData[dataKey] as any[];
    let batchIndex = 0;

    for (const batch of getBatches(allData, itemsPerMessage)) {
      const batchRequest = { ...requestData, [dataKey]: batch };
      try {
        const confirmation = await this._module.sendCall(
          stationId,
          tenantId,
          version,
          action,
          batchRequest,
          callbackUrl,
        );
        confirmations.push({
          success: confirmation.success,
          payload: `Batch [${batchIndex}]: ${confirmation.payload}`,
        });
      } catch (error) {
        confirmations.push({
          success: false,
          payload: `Batch [${batchIndex}]: ${
            error instanceof Error ? error.message : JSON.stringify(error)
          }`,
        });
      }
      batchIndex++;
    }

    return confirmations;
  }

  /**
   * Overrides superclass method to generate the URL path based on the input {@link CallAction}
   * and the module's endpoint prefix configuration.
   *
   * @param {CallAction} input - The input {@link CallAction}.
   * @return {string} - The generated URL path.
   */
  protected _toMessagePath(input: CallAction): string {
    const endpointPrefix =
      this._module.config.modules.monitoring.endpointPrefix;
    return super._toMessagePath(input, endpointPrefix);
  }

  /**
   * Overrides superclass method to generate the URL path based on the input {@link Namespace}
   * and the module's endpoint prefix configuration.
   *
   * @param {Namespace} input - The input {@link Namespace}.
   * @return {string} - The generated URL path.
   */
  protected _toDataPath(input: Namespace): string {
    const endpointPrefix =
      this._module.config.modules.monitoring.endpointPrefix;
    return super._toDataPath(input, endpointPrefix);
  }
}
