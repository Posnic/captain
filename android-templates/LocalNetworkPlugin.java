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
    private final java.util.concurrent.ExecutorService requests = java.util.concurrent.Executors.newFixedThreadPool(8);
    private final java.util.concurrent.ConcurrentHashMap<String, Boolean> pending = new java.util.concurrent.ConcurrentHashMap<>();
    private final java.util.concurrent.ConcurrentHashMap<String, java.net.HttpURLConnection> active = new java.util.concurrent.ConcurrentHashMap<>();
    @PluginMethod
    public void cancelRequest(PluginCall call) {
        String id = call.getString("id", "");
        pending.remove(id);
        java.net.HttpURLConnection connection = active.remove(id);
        if (connection != null) requests.execute(connection::disconnect);
        call.resolve();
    }
    // Route only this request through Wi-Fi. Android can choose cellular as
    // the default network when the shop router has lost its Internet uplink.
    // Process-wide binding would break simultaneous cloud requests.
    @PluginMethod
    public void request(PluginCall call) {
        String id = call.getString("id", "");
        if (id.isEmpty()) { call.reject("Request ID is required"); return; }
        pending.put(id, true);
        final long started = android.os.SystemClock.elapsedRealtime();
        requests.execute(() -> {
            java.net.HttpURLConnection connection = null;
            try {
                if (!pending.containsKey(id) || android.os.SystemClock.elapsedRealtime() - started > 7000)
                    throw new java.io.IOException("Local request cancelled or expired");
                java.net.URL url = new java.net.URL(call.getString("url", ""));
                String host = url.getHost();
                if (!host.matches("[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+") ||
                    !(url.getProtocol().equals("http") || url.getProtocol().equals("https")) ||
                    url.getUserInfo() != null || !url.getPath().startsWith("/api/"))
                    throw new IllegalArgumentException("Only local shop API addresses are supported");
                byte[] address = java.net.InetAddress.getByName(host).getAddress();
                int first = address[0] & 255, second = address[1] & 255;
                if (!(first == 10 || (first == 172 && second >= 16 && second <= 31) ||
                    (first == 192 && second == 168)))
                    throw new IllegalArgumentException("A private shop address is required");
                ConnectivityManager manager = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
                Network wifi = null;
                if (manager != null) for (Network network : manager.getAllNetworks()) {
                    NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
                    if (capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) &&
                        !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) { wifi = network; break; }
                }
                if (wifi == null) throw new java.io.IOException("Shop Wi-Fi is not connected");
                connection = (java.net.HttpURLConnection) wifi.openConnection(url);
                active.put(id, connection);
                if (!pending.containsKey(id)) throw new java.io.IOException("Local request cancelled");
                connection.setConnectTimeout(2500);
                connection.setReadTimeout(7000);
                connection.setInstanceFollowRedirects(false);
                connection.setUseCaches(false);
                connection.setRequestMethod(call.getString("method", "GET"));
                JSObject headers = call.getObject("headers", new JSObject());
                java.util.Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    if (!key.equalsIgnoreCase("Cookie") && !key.equalsIgnoreCase("Host"))
                        connection.setRequestProperty(key, headers.getString(key));
                }
                String body = call.getString("body");
                if (body != null) {
                    connection.setDoOutput(true);
                    byte[] bytes = body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    connection.setFixedLengthStreamingMode(bytes.length);
                    try (java.io.OutputStream out = connection.getOutputStream()) { out.write(bytes); }
                }
                int status = connection.getResponseCode();
                // Never follow redirects carrying the shop's credentials or order.
                if (status >= 300 && status < 400) throw new java.io.IOException("Shop API redirected the request");
                JSObject result = new JSObject();
                result.put("status", status);
                JSObject responseHeaders = new JSObject();
                for (java.util.Map.Entry<String, java.util.List<String>> entry : connection.getHeaderFields().entrySet()) {
                    if (entry.getKey() != null) responseHeaders.put(entry.getKey(), android.text.TextUtils.join(", ", entry.getValue()));
                }
                result.put("headers", responseHeaders);
                java.io.InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
                if (stream != null) try (java.io.InputStream in = stream) {
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = in.read(buffer)) != -1) {
                        if (output.size() + count > 20 * 1024 * 1024) throw new java.io.IOException("Shop reply is too large");
                        output.write(buffer, 0, count);
                    }
                }
                result.put("data", android.util.Base64.encodeToString(output.toByteArray(), android.util.Base64.NO_WRAP));
                call.resolve(result);
            } catch (Exception error) { call.reject("Local shop request failed", error); }
            finally { pending.remove(id); active.remove(id); if (connection != null) connection.disconnect(); }
        });
    }
    @Override protected void handleOnDestroy() {
        pending.clear();
        requests.shutdownNow();
        for (java.net.HttpURLConnection connection : active.values()) connection.disconnect();
        active.clear();
        super.handleOnDestroy();
    }
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
