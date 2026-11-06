import os from "os"

// adapters that are never how phones in the room reach this computer
const VIRTUAL_ADAPTER = /(vethernet|virtualbox|vmware|hyper-v|wsl|docker|vbox|loopback|tailscale|zerotier|hamachi|radmin|bluetooth|tap-|tun|utun|bridge|npcap|nordlynx|wireguard|vpn)/i

export interface LanAddress {
    address: string
    interface: string
}

function privateRank(ip: string): number {
    if (ip.startsWith("192.168.")) return 0
    if (ip.startsWith("10.")) return 1
    const second = Number(ip.split(".")[1])
    if (ip.startsWith("172.") && second >= 16 && second <= 31) return 2
    if (ip.startsWith("169.254.")) return 9 // link-local: no DHCP, rarely useful
    return 5
}

/** IPv4 addresses phones on the local network can reach, most likely first */
export function getLanAddresses(): LanAddress[] {
    const list: LanAddress[] = []
    const interfaces = os.networkInterfaces()
    for (const [name, entries] of Object.entries(interfaces)) {
        if (!entries || VIRTUAL_ADAPTER.test(name)) continue
        for (const entry of entries) {
            if (entry.family !== "IPv4" || entry.internal) continue
            list.push({ address: entry.address, interface: name })
        }
    }
    return list.sort((a, b) => privateRank(a.address) - privateRank(b.address))
}

export function addressesKey(list: LanAddress[]) {
    return list
        .map((a) => a.address)
        .sort()
        .join(",")
}
