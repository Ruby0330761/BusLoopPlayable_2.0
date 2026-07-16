using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

public static class VatMeshExporter
{
    public static void Export()
    {
        const string modelPath = "Assets/Idle_boy01.fbx";
        var importer = AssetImporter.GetAtPath(modelPath) as ModelImporter;
        if (importer == null) throw new InvalidOperationException("Idle_boy01.fbx importer was not found.");
        if (!importer.isReadable)
        {
            importer.isReadable = true;
            importer.SaveAndReimport();
        }

        var mesh = AssetDatabase.LoadAllAssetsAtPath(modelPath)
            .OfType<Mesh>()
            .OrderByDescending(candidate => candidate.vertexCount)
            .FirstOrDefault();
        if (mesh == null) throw new InvalidOperationException("Idle_boy01.fbx contains no mesh.");

        var output = Environment.GetEnvironmentVariable("VAT_EXPORT_OUTPUT");
        if (string.IsNullOrWhiteSpace(output)) throw new InvalidOperationException("VAT_EXPORT_OUTPUT is missing.");
        Directory.CreateDirectory(Path.GetDirectoryName(output));

        var vertices = mesh.vertices;
        var normals = mesh.normals;
        var uv = mesh.uv;
        var indices = mesh.GetIndices(0);
        using (var writer = new BinaryWriter(File.Create(output)))
        {
            writer.Write(new byte[] { 0x56, 0x41, 0x54, 0x4d });
            writer.Write(1);
            writer.Write(vertices.Length);
            writer.Write(indices.Length);
            foreach (var value in vertices)
            {
                writer.Write(value.x);
                writer.Write(value.y);
                writer.Write(value.z);
            }
            for (var i = 0; i < vertices.Length; i++)
            {
                var value = normals.Length == vertices.Length ? normals[i] : Vector3.up;
                writer.Write(value.x);
                writer.Write(value.y);
                writer.Write(value.z);
            }
            for (var i = 0; i < vertices.Length; i++)
            {
                var value = uv.Length == vertices.Length ? uv[i] : Vector2.zero;
                writer.Write(value.x);
                writer.Write(value.y);
            }
            foreach (var index in indices) writer.Write(index);
        }

        Debug.Log($"VAT mesh exported: {mesh.name}, vertices={vertices.Length}, indices={indices.Length}, output={output}");
    }
}
