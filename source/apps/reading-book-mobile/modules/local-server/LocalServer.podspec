Pod::Spec.new do |s|
  s.name           = 'LocalServer'
  s.version        = '1.0.0'
  s.summary        = 'Loopback server for the bundled Readmate UI'
  s.description    = 'Serves the bundled Readmate UI to the WebView on 127.0.0.1'
  s.license        = 'UNLICENSED'
  s.author         = 'Readmate'
  s.homepage       = 'https://github.com/LeThaiAn15112004/reading-book-app'
  s.platforms      = { :ios => '18.2' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = 'ios/**/*.swift'
  # A folder reference, so web-ui/assets/... keeps its layout. Written by `npm run build:web`.
  s.resources = 'ui-assets/web-ui'
end
