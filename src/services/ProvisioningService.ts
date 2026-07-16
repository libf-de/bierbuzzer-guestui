import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface ProvisioningOptions {
  mode: "docker" | "native";
  adminUser: string;
  adminPass: string;
  host: string;
  port: string;
  network: string;
  image: string;
}

/**
 * Wraps `mosquitto_ctrl dynsec ...` to manage the dynamic-security plugin's
 * clients/roles/ACLs. Default mode shells out via `docker run`; "native"
 * calls mosquitto_ctrl directly (needs mosquitto-clients on the host).
 *
 * NOTE: admin pass is passed as a CLI arg (-P). It is visible in the child
 * process's argv. Acceptable on a single-tenant host; use MOSQUITTO_CTRL_MODE
 * with a pw file if you need to avoid that.
 */
export class ProvisioningService {
  constructor(private readonly opts: ProvisioningOptions) {}

  private async ctrl(args: string[]): Promise<string> {
    const base = [
      "-h",
      this.opts.host,
      "-p",
      this.opts.port,
      "-u",
      this.opts.adminUser,
      "-P",
      this.opts.adminPass,
      "dynsec",
      ...args,
    ];

    const [cmd, cmdArgs] =
      this.opts.mode === "docker"
        ? [
            "docker",
            [
              "run",
              "--rm",
              "--network",
              this.opts.network,
              this.opts.image,
              "mosquitto_ctrl",
              ...base,
            ],
          ]
        : ["mosquitto_ctrl", base];

    try {
      const { stdout } = await execFileAsync(cmd, cmdArgs, { timeout: 30_000 });
      return stdout;
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      throw new Error(`mosquitto_ctrl failed: ${e.stderr?.trim() || e.message}`);
    }
  }

  /**
   * Create a device client + role scoped to exactly its own topics.
   * ACLs (no wildcards): the device may subscribe to its config/set and
   * publish its config/ack and status.
   */
  async createDeviceClient(topicId: string, password: string): Promise<void> {
    const username = `device_${topicId}`;
    const role = `role_${topicId}`;

    await this.ctrl(["createClient", username, "--password", password]);
    await this.ctrl(["createRole", role]);
    await this.ctrl(["addRoleACL", role, "subscribePattern", `devices/${topicId}/config/set`]);
    await this.ctrl(["addRoleACL", role, "publishClientSend", `devices/${topicId}/config/ack`]);
    await this.ctrl(["addRoleACL", role, "publishClientSend", `devices/${topicId}/status`]);
    await this.ctrl(["addClientRole", username, role]);
  }

  async deleteDeviceClient(topicId: string): Promise<void> {
    const username = `device_${topicId}`;
    const role = `role_${topicId}`;
    // Delete client first so the role has no members, then the role.
    await this.ctrl(["deleteClient", username]);
    await this.ctrl(["deleteRole", role]);
  }
}
