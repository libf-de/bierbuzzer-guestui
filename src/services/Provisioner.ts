/**
 * Broker-side provisioning of dynsec clients/roles/ACLs. Two impls:
 *   - ProvisioningService     (shells out to mosquitto_ctrl)
 *   - MqttProvisioningService (publishes dynsec control commands over MQTT)
 */
export interface Provisioner {
  createDeviceClient(topicId: string, password: string): Promise<void>;
  deleteDeviceClient(topicId: string): Promise<void>;
}
