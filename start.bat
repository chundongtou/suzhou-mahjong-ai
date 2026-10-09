@echo off
chcp 65001 >nul
title 苏州麻将AI军师
cd /d "%~dp0"

rem 检测 Ollama 是否在运行
tasklist /fi "imagename eq ollama.exe" 2>nul | find /i "ollama.exe" >nul
if errorlevel 1 (
    echo [提示] Ollama 未运行, 正在启动...
    start "" "ollama.exe" serve
    timeout /t 3 /nobreak >nul
)

rem 启动本地服务(系统Python优先, 否则hermes环境)
set PYEXE=
if exist "C:\Program Files\Python311\python.exe" set PYEXE=C:\Program Files\Python311\python.exe
if not defined PYEXE if exist "C:\Python311\python.exe" set PYEXE=C:\Python311\python.exe
if not defined PYEXE set PYEXE=python

"%PYEXE%" server.py
if errorlevel 1 (
    echo.
    echo 启动失败, 请确认已安装 Python 且装有 flask: pip install flask
    pause
)
