export interface Domain {
  id: string;
  name: string;
  type: string;
}

export interface SshConnection {
  ssh_port: string;
  ssh_ip: { external_ip: string };
}

export interface ContainerInfo {
  id: string;
  php_engine_version: string;
}

export interface Environment {
  id: string;
  name: string;
  display_name: string;
  is_premium?: boolean;
  is_blocked?: boolean;
  id_edge_cache?: string;
  cdn_cache_id?: string;
  web_root?: string;
  wordpress_version?: string;
  domains?: Domain[];
  primaryDomain?: Domain | null;
  ssh_connection?: SshConnection;
  container_info?: ContainerInfo;
}

export interface Site {
  id: string;
  name: string;
  display_name: string;
  status?: string;
  environments: Environment[];
}

/** Response of GET /sites/{site_id}/environments/{env_id}/ssh/config */
export interface SshConfig {
  name: string;
  host: string;
  port: string;
  user: string;
  ssh_command: string;
}

/** A site paired with the environment we operate on (usually the live env). */
export interface ResolvedSite {
  site: Site;
  env: Environment;
}
