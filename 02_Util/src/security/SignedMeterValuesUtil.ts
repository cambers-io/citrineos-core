import {
  IChargingStationSecurityInfoRepository,
  IDeviceModelRepository,
  sequelize,
} from '@citrineos/data';
import {
  IFileAccess,
  MeterValueType,
  SignedMeterValuesConfig,
  SignedMeterValueType,
  SystemConfig,
} from '@citrineos/base';
import { ILogObj, Logger } from 'tslog';
import * as crypto from 'node:crypto';
import { stringToArrayBuffer } from 'pvutils';
import { SampledValueType } from '@citrineos/base/dist/ocpp/model/types/MeterValuesRequest';

/**
 * Util to process and validate signed meter values.
 */
export class SignedMeterValuesUtil {
  private readonly _fileAccess: IFileAccess;
  private readonly _logger: Logger<ILogObj>;
  private readonly _deviceModelRepository: IDeviceModelRepository;
  private readonly _chargingStationSecurityInfoRepository: IChargingStationSecurityInfoRepository;

  private readonly _signedMeterValuesConfiguration:
    | SignedMeterValuesConfig
    | undefined;

  /**
   * @param {IFileAccess} [fileAccess] - The `fileAccess` allows access to the configured file storage.
   *
   * @param {SystemConfig} config - The `config` contains the current system configuration settings.
   *
   * @param {Logger<ILogObj>} [logger] - The `logger` represents an instance of {@link Logger<ILogObj>}.
   *
   * @param {IDeviceModelRepository} [deviceModelRepository] - The `deviceModelRepository` represents a repository for accessing and manipulating variable attribute data.
   *
   */
  constructor(
    fileAccess: IFileAccess,
    config: SystemConfig,
    logger: Logger<ILogObj>,
    deviceModelRepository: IDeviceModelRepository,
  ) {
    this._fileAccess = fileAccess;
    this._logger = logger;
    this._deviceModelRepository = deviceModelRepository;
    this._chargingStationSecurityInfoRepository =
      new sequelize.SequelizeChargingStationSecurityInfoRepository(
        config,
        logger,
      );

    this._signedMeterValuesConfiguration =
      config.modules.transactions.signedMeterValuesConfiguration;
  }

  /**
   * Checks the validity of a meter value.
   *
   * If a meter value is unsigned, it is valid.
   *
   * If a meter value is signed, it is valid if:
   * - SignedMeterValuesConfig is configured
   * AND
   * - The incoming signed meter value's signing method matches the configured signing method
   * AND
   * - The incoming signed meter value's public key is empty but there is a public key stored for that charging station
   * OR
   * - The incoming signed meter value's public key isn't empty and it matches the configured public key
   *
   * @param stationId - The charging station the meter values belong to
   * @param meterValues - The list of meter values
   */
  public async validateMeterValues(
    stationId: string,
    meterValues: [MeterValueType, ...MeterValueType[]],
  ): Promise<boolean> {
    let validMeterValues = true;

    const publicKeyFrequencyVariableAttribute =
      await this._deviceModelRepository.readAllByQuerystring({
        stationId,
        component_name: 'OCPPCommCtrlr',
        variable_name: 'PublicKeyWithSignedMeterValue',
      });

    const shouldPublicKeyBeUsedForValidation =
      publicKeyFrequencyVariableAttribute.length > 0 &&
      publicKeyFrequencyVariableAttribute[0].value !== 'Never';

    if (shouldPublicKeyBeUsedForValidation) {
      for (const meterValue of meterValues) {
        for (const sampledValue of meterValue.sampledValue) {
          validMeterValues =
            validMeterValues &&
            (await this.isSignedSampledValueValid(stationId, sampledValue));
        }
      }
    }

    return validMeterValues;
  }

  private async isMeterValueSignatureValid(
    signedMeterValue: SignedMeterValueType,
    publicKeyFileId?: string,
  ): Promise<boolean> {
    const incomingPublicKeyString = signedMeterValue.publicKey;
    const signingMethod = signedMeterValue.signingMethod;

    if (
      !this._signedMeterValuesConfiguration?.publicKeyFileId ||
      (publicKeyFileId &&
        publicKeyFileId !==
          this._signedMeterValuesConfiguration?.publicKeyFileId) ||
      (!publicKeyFileId && incomingPublicKeyString.length === 0) ||
      this._signedMeterValuesConfiguration?.signingMethod !== signingMethod
    ) {
      return false;
    }

    const configuredPublicKey = this.formatKey(
      (
        await this._fileAccess.getFile(
          this._signedMeterValuesConfiguration.publicKeyFileId,
        )
      ).toString(),
    );

    if (incomingPublicKeyString.length > 0) {
      const signedMeterValuePublicKey = Buffer.from(
        signedMeterValue.publicKey,
        'base64',
      ).toString();

      if (configuredPublicKey !== signedMeterValuePublicKey) {
        return false;
      }
    }

    switch (signingMethod) {
      case 'RSASSA-PKCS1-v1_5':
        try {
          const cryptoPublicKey = await crypto.subtle.importKey(
            'spki',
            stringToArrayBuffer(atob(configuredPublicKey)),
            { name: signingMethod, hash: signedMeterValue.encodingMethod },
            true,
            ['verify'],
          );

          const signatureBuffer = Buffer.from(
            signedMeterValue.signedMeterData,
            'base64',
          );
          // For now, we only care that the signature could be read, regardless of the value in the signature.
          await crypto.subtle.verify(
            signingMethod,
            cryptoPublicKey,
            signatureBuffer,
            signatureBuffer,
          );
          return true;
        } catch (e) {
          const errorMessage =
            e instanceof DOMException ? e.message : JSON.stringify(e);
          this._logger.warn(
            `Error decrypting private key or verifying signature from Signed Meter Value. Error: ${errorMessage}`,
          );
          return false;
        }
      default:
        this._logger.warn(
          `${signingMethod} is not supported for Signed Meter Values.`,
        );
        return false;
    }
  }

  private async isSignedSampledValueValid(
    stationId: string,
    sampledValue: SampledValueType,
  ): Promise<boolean> {
    const signedMeterValue = sampledValue.signedMeterValue;

    if (!signedMeterValue) {
      return true;
    }

    if (signedMeterValue.publicKey && signedMeterValue.publicKey.length > 0) {
      const incomingPublicKeyIsValid =
        await this.isMeterValueSignatureValid(signedMeterValue);

      if (this._signedMeterValuesConfiguration && incomingPublicKeyIsValid) {
        await this._chargingStationSecurityInfoRepository.readOrCreateChargingStationInfo(
          stationId,
          this._signedMeterValuesConfiguration.publicKeyFileId,
        );

        return true;
      } else {
        return false;
      }
    } else {
      const chargingStationPublicKeyFileId =
        await this._chargingStationSecurityInfoRepository.readChargingStationPublicKeyFileId(
          stationId,
        );
      return await this.isMeterValueSignatureValid(
        signedMeterValue,
        chargingStationPublicKeyFileId,
      );
    }
  }

  private formatKey(key: string) {
    return key
      .replace('-----BEGIN PUBLIC KEY-----', '')
      .replace('-----END PUBLIC KEY-----', '')
      .replace(/(\r\n|\n|\r)/gm, '');
  }
}
