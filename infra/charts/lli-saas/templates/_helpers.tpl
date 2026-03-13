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
