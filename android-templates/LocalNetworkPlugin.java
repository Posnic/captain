package com.posnic.captain;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.Inet4Address;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;

@CapacitorPlugin(name = "LocalNetwork")
public class LocalNetworkPlugin extends Plugin {
    @PluginMethod
    public void openWifiSettings(PluginCall call) {
        try {
            android.content.Intent intent = new android.content.Intent(android.provider.Settings.ACTION_WIFI_SETTINGS);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Unable to open Wi-Fi settings", error);
        }
    }
    @PluginMethod
    public void getLocalIp(PluginCall call) {
        try {
            ConnectivityManager manager = (ConnectivityManager) getContext()
                    .getSystemService(Context.CONNECTIVITY_SERVICE);
            // A wlan interface can retain its address after the radio is off.
            // Only Android's currently connected Wi-Fi networks may seed a scan.
            if (manager != null) for (Network network : manager.getAllNetworks()) {
                NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
                if (capabilities == null || !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) continue;
                LinkProperties properties = manager.getLinkProperties(network);
                if (properties == null) continue;
                for (LinkAddress link : properties.getLinkAddresses()) {
                    if (!(link.getAddress() instanceof Inet4Address)) continue;
                    JSObject result = new JSObject();
                    result.put("ip", link.getAddress().getHostAddress());
                    result.put("wifi", true);
                    call.resolve(result);
                    return;
                }
            }

            JSObject result = new JSObject();
            result.put("ip", "");
            result.put("wifi", false);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to read local network address", error);
        }
    }
}
