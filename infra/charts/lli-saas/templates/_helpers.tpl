{{- define "lli-saas.serviceName" -}}
{{- .name -}}
{{- end -}}

{{- define "lli-saas.imageRef" -}}
{{- $image := . -}}
{{- if $image.reference -}}
{{- $image.reference -}}
{{- else if $image.digest -}}
{{- printf "%s@%s" $image.repository $image.digest -}}
{{- else -}}
{{- printf "%s:%s" $image.repository $image.tag -}}
{{- end -}}
{{- end -}}

{{/*
Fail if any env value still contains the placeholder domain example.com or
a replace-with-* sentinel.  Guarded by .Values.validatePlaceholders.
*/}}
{{- define "lli-saas.validateEnv" -}}
{{- range $envKey, $envValue := . }}
{{- if regexMatch "example\\.com|replace-with-" (toString $envValue) }}
{{- fail (printf "Placeholder detected in env var %s: %s — override it in values.pilot.yaml or infra/.env" $envKey (toString $envValue)) }}
{{- end }}
{{- end }}
{{- end -}}
