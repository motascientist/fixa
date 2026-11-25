package app.fixa;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;

/**
 * Casca do Fixa para Android: abre o site que vai DENTRO do APK (pasta assets), sem internet.
 *
 * O site é servido num endereço https de mentira, reservado pelo Google para isso
 * (appassets.androidplatform.net). Precisa ser https para o navegador liberar microfone e
 * armazenamento; nenhuma requisição sai do aparelho — o app nem tem a permissão INTERNET.
 *
 * O que o navegador embutido não faz sozinho e esta classe resolve:
 *  - escolher arquivo (imagem, áudio, backup);
 *  - pedir o microfone para gravar;
 *  - salvar o backup num arquivo — ponte FixaAndroid.salvarBackup.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String ORIGEM = "https://" + HOST + "/";
    private static final int PEDIDO_ARQUIVO = 1;
    private static final int PEDIDO_MIC = 2;
    private static final int PEDIDO_SALVAR = 3;

    private WebView web;
    private ValueCallback<Uri[]> retornoArquivo;
    private PermissionRequest pedidoMic;
    private String backupPendente;

    @Override
    protected void onCreate(Bundle estado) {
        super.onCreate(estado);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);   // localStorage: o texto dos cartões
        s.setDatabaseEnabled(true);     // IndexedDB: imagem e áudio
        s.setMediaPlaybackRequiresUserGesture(false); // o áudio do cartão toca sozinho
        s.setAllowFileAccess(false);

        web.addJavascriptInterface(new Ponte(), "FixaAndroid");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                return servir(req.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                return !HOST.equals(req.getUrl().getHost()); // nada navega para fora do app
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> retorno, FileChooserParams p) {
                if (retornoArquivo != null) retornoArquivo.onReceiveValue(null);
                retornoArquivo = retorno;
                try {
                    startActivityForResult(p.createIntent(), PEDIDO_ARQUIVO);
                    return true;
                } catch (Exception e) {
                    retornoArquivo = null;
                    return false;
                }
            }

            @Override
            public void onPermissionRequest(final PermissionRequest pedido) {
                runOnUiThread(() -> {
                    boolean querMic = false;
                    for (String r : pedido.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) querMic = true;
                    }
                    if (!querMic) {
                        pedido.deny();
                    } else if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        pedido.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    } else {
                        pedidoMic = pedido;
                        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, PEDIDO_MIC);
                    }
                });
            }
        });

        web.loadUrl(ORIGEM + "index.html");
    }

    /** Entrega um arquivo da pasta assets como se viesse do endereço https do app. */
    private WebResourceResponse servir(Uri u) {
        if (!HOST.equals(u.getHost())) return null;
        String caminho = u.getPath();
        if (caminho == null || caminho.equals("/")) caminho = "/index.html";
        caminho = caminho.substring(1);
        if (!caminho.contains("..")) {
            try {
                return new WebResourceResponse(tipo(caminho), ehTexto(caminho) ? "utf-8" : null, getAssets().open(caminho));
            } catch (IOException e) {
                // cai no 404 abaixo
            }
        }
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
    }

    private static boolean ehTexto(String c) {
        return !c.endsWith(".png");
    }

    private static String tipo(String c) {
        if (c.endsWith(".html")) return "text/html";
        if (c.endsWith(".css")) return "text/css";
        if (c.endsWith(".js")) return "text/javascript";
        if (c.endsWith(".png")) return "image/png";
        if (c.endsWith(".webmanifest") || c.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    @Override
    protected void onActivityResult(int pedido, int resultado, Intent dados) {
        super.onActivityResult(pedido, resultado, dados);
        if (pedido == PEDIDO_ARQUIVO) {
            if (retornoArquivo != null) {
                retornoArquivo.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultado, dados));
                retornoArquivo = null;
            }
        } else if (pedido == PEDIDO_SALVAR) {
            String conteudo = backupPendente;
            backupPendente = null;
            if (resultado != RESULT_OK || dados == null || dados.getData() == null || conteudo == null) return;
            boolean ok = true;
            try (OutputStream out = getContentResolver().openOutputStream(dados.getData())) {
                out.write(conteudo.getBytes(StandardCharsets.UTF_8));
            } catch (Exception e) {
                ok = false;
            }
            web.evaluateJavascript("window.backupSalvo && window.backupSalvo(" + ok + ")", null);
        }
    }

    @Override
    public void onRequestPermissionsResult(int pedido, String[] permissoes, int[] resultados) {
        super.onRequestPermissionsResult(pedido, permissoes, resultados);
        if (pedido != PEDIDO_MIC || pedidoMic == null) return;
        if (resultados.length > 0 && resultados[0] == PackageManager.PERMISSION_GRANTED) {
            pedidoMic.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            pedidoMic.deny();
        }
        pedidoMic = null;
    }

    /** Botão voltar do celular: volta de tela dentro do app (do estudo para o início) antes de sair. */
    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    /** O que o site consegue pedir ao Android. Só uma coisa: salvar o backup num arquivo. */
    private class Ponte {
        @JavascriptInterface
        public void salvarBackup(String nome, String conteudo) {
            backupPendente = conteudo;
            final Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("application/json");
            i.putExtra(Intent.EXTRA_TITLE, nome);
            runOnUiThread(() -> startActivityForResult(i, PEDIDO_SALVAR));
        }
    }
}
